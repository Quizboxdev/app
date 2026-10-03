-- Competition operations (clone/archive/close/scheduled visibility/readiness/version view), school
-- administration, Super Admin operations and failure observability. Core engine actions are delegated.
begin;

alter function quizbox_competition.dispatch(text,uuid,jsonb) rename to dispatch_review_ops;
revoke all on function quizbox_competition.dispatch_review_ops(text,uuid,jsonb) from public,anon,authenticated;

create function quizbox_competition.dispatch(p_action text,p_sponsor uuid,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid:=nullif(p_data->>'competition_id','')::uuid; comp public.competitions; d quizbox_competition.drafts; snap quizbox_competition.snapshots; result jsonb; cfg jsonb;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'INVALID_SPONSOR_INPUT'; end if;

 -- Participant-facing gates: closed/archived competitions accept no new registrations or attempts;
 -- scheduled visibility hides a published competition until its publishAt time.
 if p_action in ('register','start_competition') then
  select * into comp from public.competitions where id=c;
  if comp.status in ('CLOSED','ARCHIVED') then raise exception 'COMPETITION_CLOSED'; end if;
 end if;
 if p_action='discover' then
  result:=quizbox_competition.dispatch_review_ops(p_action,p_sponsor,p_data);
  return coalesce((select jsonb_agg(e) from jsonb_array_elements(result) e join quizbox_competition.snapshots s on s.competition_id=(e->>'competition_id')::uuid
   join public.competitions x on x.id=s.competition_id
   where x.status='PUBLISHED' and coalesce(nullif(s.payload#>>'{configuration,publishAt}','')::timestamptz,'-infinity')<=now()
   and s.version=(select max(version) from quizbox_competition.snapshots where competition_id=s.competition_id)),'[]');
 end if;
 if p_action='leaderboard' then
  select * into snap from quizbox_competition.snapshots where competition_id=c order by version desc limit 1;
  result:=quizbox_competition.dispatch_delivery(p_action,p_sponsor,p_data); cfg:=snap.payload->'configuration';
  -- Display label only; market for multi-market/global scopes; institution only when the sponsor opted in.
  return coalesce((select jsonb_agg(jsonb_strip_nulls((e-'participant_id')||jsonb_build_object(
    'display_name',quizbox_competition.participant_label((e->>'participant_id')::uuid,(e->>'rank')::integer),
    'is_you',(e->>'participant_id')::uuid=auth.uid(),
    'market',case when cfg->>'scope'<>'LOCAL_MARKET' then (select m.name from quizbox_competition.registrations r join public.markets m on m.id=r.market_id where r.competition_id=c and r.participant_id=(e->>'participant_id')::uuid) end,
    'institution',case when coalesce((cfg->>'leaderboardShowInstitution')::boolean,false) then (select i.name from quizbox_competition.registrations r join public.institutions i on i.id=r.institution_id where r.competition_id=c and r.participant_id=(e->>'participant_id')::uuid) end)))
   from jsonb_array_elements(result) e),'[]');
 end if;

 if p_action in ('clone_competition','archive_competition','close_competition','published_version','eligibility_summary','readiness','competition_comparison') then
  if p_action='competition_comparison' then
   perform quizbox_competition.require_member(p_sponsor,false);
   return coalesce((select jsonb_agg(jsonb_build_object('title',x.configuration->>'title','status',coalesce(co.status,'DRAFT'),'scope',x.configuration->>'scope',
     'registrations',(select count(*) from quizbox_competition.registrations r where r.competition_id=x.competition_id and r.eligible),
     'started',(select count(*) from quizbox_competition.participations p where p.competition_id=x.competition_id),
     'completed',(select count(*) from quizbox_competition.official_results o where o.competition_id=x.competition_id),
     'average_percentage',(select round(avg(o.percentage),1) from quizbox_competition.official_results o where o.competition_id=x.competition_id)) order by x.created_at desc)
    from quizbox_competition.drafts x left join public.competitions co on co.id=x.competition_id where x.sponsor_id=p_sponsor),'[]');
  end if;
  perform quizbox_competition.require_member(p_sponsor,p_action in ('clone_competition','archive_competition','close_competition'));
  select * into d from quizbox_competition.drafts where competition_id=c and sponsor_id=p_sponsor;
  if d.competition_id is null then raise exception 'COMPETITION_ACCESS_DENIED' using errcode='42501'; end if;
  select * into comp from public.competitions where id=c;
  select * into snap from quizbox_competition.snapshots where competition_id=c order by version desc limit 1;
  if p_action='clone_competition' then
   -- Configuration only: sources, candidates, snapshots and results are never copied.
   return quizbox_competition.dispatch_review_ops('save_draft',p_sponsor,jsonb_build_object('competition_id',null,'revision',null,
    'configuration',(d.configuration-'sourceIds'-'publishAt')||jsonb_build_object('title',left(coalesce(d.configuration->>'title','Competition'),180)||' (copy)','step',0,'sourceIds','[]'::jsonb)));
  elsif p_action='archive_competition' then
   if comp.status='PUBLISHED' and now()<(snap.payload#>>'{configuration,endsAt}')::timestamptz then raise exception 'COMPETITION_STILL_RUNNING'; end if;
   update public.competitions set status='ARCHIVED' where id=c;
   insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details) values(auth.uid(),'QB_COMPETITION_ARCHIVED','competitions',c,'pass','{}');
   return jsonb_build_object('competition_id',c,'status','ARCHIVED');
  elsif p_action='close_competition' then
   if comp.status<>'PUBLISHED' then raise exception 'COMPETITION_NOT_PUBLISHED'; end if;
   update public.competitions set status='CLOSED' where id=c;
   insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details) values(auth.uid(),'QB_COMPETITION_CLOSED','competitions',c,'pass',jsonb_build_object('reason',left(p_data->>'reason',300)));
   return jsonb_build_object('competition_id',c,'status','CLOSED');
  elsif p_action='published_version' then
   if snap.id is null then raise exception 'NO_PUBLISHED_VERSION'; end if;
   return jsonb_build_object('version',snap.version,'checksum',snap.checksum,'published_at',snap.published_at,'configuration',snap.payload->'configuration','source_context',snap.payload->'source_context',
    'questions',coalesce((select jsonb_agg(jsonb_build_object('question_id',q->>'question_id','version_id',q->>'version_id','content',(q->'content')-'correctAnswer'-'correct_answer'-'answer_spec'-'correct_answer_snapshot')) from jsonb_array_elements(snap.payload->'questions') q),'[]'));
  elsif p_action='eligibility_summary' then
   return jsonb_build_object('registered',(select count(*) from quizbox_competition.registrations where competition_id=c and eligible),
    'ineligible',(select count(*) from quizbox_competition.registrations where competition_id=c and not eligible),
    'by_market',coalesce((select jsonb_agg(jsonb_build_object('market',coalesce(m.name,'-'),'registrations',x.n)) from (select market_id,count(*) n from quizbox_competition.registrations where competition_id=c group by 1) x left join public.markets m on m.id=x.market_id),'[]'),
    'blockers',coalesce((select jsonb_object_agg(b,n) from (select b,count(*) n from quizbox_competition.registrations r cross join jsonb_array_elements_text(r.eligibility_snapshot->'blockers') b where r.competition_id=c group by 1) x),'{}'));
  elsif p_action='readiness' then
   return jsonb_build_object('status',coalesce(comp.status,'DRAFT'),'published_version',snap.version,
    'publication_blockers',quizbox_competition.publication_blockers(c,false),
    'review',jsonb_build_object('candidates',(select count(*) from quizbox_competition.candidates where competition_id=c),
      'approved',(select count(*) from quizbox_competition.candidates where competition_id=c and status='APPROVED'),
      'pending',(select count(*) from quizbox_competition.candidates where competition_id=c and status in ('GENERATED','ASSIGNED_FOR_REVIEW','UNDER_REVIEW')),
      'in_bank',(select count(*) from quizbox_competition.bank_items where competition_id=c and included),
      'required',coalesce((d.configuration->>'totalQuestions')::integer,0)),
    'sources',jsonb_build_object('selected',jsonb_array_length(coalesce(d.configuration->'sourceIds','[]')),
      'ready',(select count(*) from quizbox_competition.documents doc where doc.competition_id=c and doc.ingestion_status='READY_FOR_GENERATION'),
      'approved',(select count(*) from quizbox_competition.documents doc join public.source_documents s on s.id=doc.id where doc.competition_id=c and s.validation_status='approved'),
      'total',(select count(*) from quizbox_competition.documents doc where doc.competition_id=c)));
  end if;
 end if;
 return quizbox_competition.dispatch_review_ops(p_action,p_sponsor,p_data);
end $$;
revoke all on function quizbox_competition.dispatch(text,uuid,jsonb) from public,anon;
grant execute on function quizbox_competition.dispatch(text,uuid,jsonb) to authenticated;

-- School administration (institution admins/owners, or Super Admin). No SIS features.
create function quizbox_ops.school_admin(p_institution uuid) returns boolean language sql stable security definer set search_path='' as $$
 select quizbox_market.is_super() or exists(select 1 from public.institution_memberships m where m.institution_id=p_institution and m.user_id=auth.uid() and m.role::text in ('admin','owner') and m.status::text='active');
$$;
create function public.qb_school(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare inst uuid:=nullif(p_data->>'institution_id','')::uuid; cls public.classes; target public.classes; m public.class_memberships; teacher uuid;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_action='my_schools' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'role',im.role)) from public.institutions i join public.institution_memberships im on im.institution_id=i.id
   where im.user_id=auth.uid() and im.role::text in ('admin','owner') and im.status::text='active'),'[]');
 end if;
 if p_action in ('assign_teacher','archive_class','transfer_student') then
  select * into cls from public.classes where id=(p_data->>'class_id')::uuid for update; inst:=cls.institution_id;
 end if;
 if inst is null or not quizbox_ops.school_admin(inst) then raise exception 'QB_SCHOOL_ADMIN_REQUIRED' using errcode='42501'; end if;
 if p_action='overview' then
  return jsonb_build_object('institution',(select name from public.institutions where id=inst),
   'teachers',coalesce((select jsonb_agg(jsonb_build_object('user_id',p.id,'name',p.full_name,'role',im.role)) from public.institution_memberships im join public.profiles p on p.id=im.user_id where im.institution_id=inst and im.status::text='active' and im.role::text in ('teacher','admin','owner')),'[]'),
   'classes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.class_name,'grade',coalesce(c.grade_code,c.grade::text),'status',c.status,'teacher',(select full_name from public.profiles where id=c.teacher_user_id),
     'students',(select count(*) from public.class_memberships x where x.class_id=c.id and x.status::text='active')) order by c.status,c.class_name) from public.classes c where c.institution_id=inst),'[]'));
 elsif p_action='assign_teacher' then
  teacher:=(p_data->>'teacher_user_id')::uuid;
  if not exists(select 1 from public.institution_memberships where institution_id=inst and user_id=teacher and status::text='active' and role::text in ('teacher','admin','owner')) then raise exception 'QB_TEACHER_NOT_IN_SCHOOL'; end if;
  update public.classes set teacher_user_id=teacher,primary_teacher_id=coalesce((select id from public.teacher_profiles where user_id=teacher limit 1),primary_teacher_id) where id=cls.id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details) values(auth.uid(),'QB_CLASS_TEACHER_REASSIGNED','classes',cls.id,'pass',jsonb_build_object('from',cls.teacher_user_id,'to',teacher));
  return jsonb_build_object('class_id',cls.id,'teacher_user_id',teacher);
 elsif p_action='archive_class' then
  update public.classes set status='archived' where id=cls.id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details) values(auth.uid(),'QB_CLASS_ARCHIVED','classes',cls.id,'pass','{}');
  return jsonb_build_object('class_id',cls.id,'status','archived');
 elsif p_action='transfer_student' then
  select * into m from public.class_memberships where id=(p_data->>'membership_id')::uuid and class_id=cls.id and status::text='active' for update;
  select * into target from public.classes where id=(p_data->>'to_class_id')::uuid;
  if m.id is null or target.id is null or target.institution_id is distinct from inst or target.status::text<>'active' then raise exception 'QB_INVALID_TRANSFER'; end if;
  -- History is the closed membership row plus the new one; nothing is deleted.
  update public.class_memberships set status='inactive',left_at=now() where id=m.id;
  insert into public.class_memberships(id,class_id,student_id,student_user_id,student_email,student_name,grade,status,joined_at,approved_at,approved_by)
  values(gen_random_uuid(),target.id,m.student_id,m.student_user_id,m.student_email,m.student_name,m.grade,'active',now(),now(),auth.uid())
  on conflict do nothing;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details) values(auth.uid(),'QB_STUDENT_TRANSFERRED','class_memberships',m.id,'pass',jsonb_build_object('from_class',cls.id,'to_class',target.id));
  return jsonb_build_object('from_class',cls.id,'to_class',target.id);
 elsif p_action='history' then
  return coalesce((select jsonb_agg(jsonb_build_object('class',c.class_name,'student',x.student_name,'status',x.status,'joined_at',x.joined_at,'left_at',x.left_at) order by x.joined_at desc)
   from public.class_memberships x join public.classes c on c.id=x.class_id where c.institution_id=inst limit 200),'[]');
 end if;
 raise exception 'INVALID_SCHOOL_ACTION';
end $$;

-- Super Admin operations. Every call is authorization-checked and audited (including lookups).
create function public.qb_admin_ops(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare q text; target uuid:=nullif(p_data->>'id','')::uuid; result jsonb;
begin
 if not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode='42501'; end if;
 if p_action='lookup' then
  q:='%'||replace(replace(btrim(left(coalesce(p_data->>'query',''),80)),'%','\%'),'_','\_')||'%';
  if length(btrim(coalesce(p_data->>'query','')))<2 then return '[]'; end if;
  result:=coalesce((select jsonb_agg(jsonb_build_object('kind','user','id',p.id,'name',p.full_name,'email',p.email,'role',p.role,'status',p.status,
    'primary_market',(select name from public.markets where id=p.primary_market_id),'markets',(select string_agg(m.name,', ') from public.user_market_memberships u join public.markets m on m.id=u.market_id where u.user_id=p.id and u.active))) from (select * from public.profiles where full_name ilike q or email ilike q limit 25) p),'[]')
   ||coalesce((select jsonb_agg(jsonb_build_object('kind','sponsor','id',s.id,'name',s.organization_name,'status',s.status,'verification',s.verification_status)) from (select * from public.sponsor_profiles where organization_name ilike q limit 25) s),'[]');
 elsif p_action='set_user_status' then
  if p_data->>'status' not in ('active','inactive') or target=auth.uid() then raise exception 'INVALID_USER_STATUS'; end if;
  update public.profiles set status=(p_data->>'status')::public.qb_status where id=target; if not found then raise exception 'USER_NOT_FOUND'; end if;
  result:=jsonb_build_object('id',target,'status',p_data->>'status');
 elsif p_action='set_sponsor_status' then
  if p_data->>'status' not in ('ACTIVE','SUSPENDED') then raise exception 'INVALID_SPONSOR_STATUS'; end if;
  update public.sponsor_profiles set status=p_data->>'status' where id=target; if not found then raise exception 'SPONSOR_NOT_FOUND'; end if;
  result:=jsonb_build_object('id',target,'status',p_data->>'status');
 elsif p_action='audit_trail' then
  result:=coalesce((select jsonb_agg(jsonb_build_object('at',a.created_at,'action',a.action,'actor',coalesce((select full_name from public.profiles where id=a.actor_user_id),'system'),'entity',a.entity_type,'entity_id',a.entity_id,'status',a.status,'details',a.details) order by a.created_at desc)
   from (select * from public.audit_logs where (nullif(p_data->>'action','') is null or action ilike '%'||(p_data->>'action')||'%')
     and (nullif(p_data->>'actor','') is null or actor_user_id=(p_data->>'actor')::uuid) and (nullif(p_data->>'entity_id','') is null or entity_id=(p_data->>'entity_id')::uuid)
     order by created_at desc limit least(coalesce((p_data->>'limit')::integer,100),500)) a),'[]');
 elsif p_action='failures' then
  result:=coalesce((select jsonb_agg(jsonb_build_object('at',x.at,'source',x.src,'operation',x.op,'code',x.code) order by x.at desc) from (
    select created_at at,'audit' src,action op,details->>'error_code' code from public.audit_logs where status='fail' and created_at>now()-interval '7 days'
    union all select created_at,'system',event_type,details->>'code' from public.system_events where severity in ('warn','error') and created_at>now()-interval '7 days' order by 1 desc limit 200) x),'[]');
 else raise exception 'INVALID_ADMIN_ACTION';
 end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details)
 values(auth.uid(),'QB_ADMIN_'||upper(p_action),case when p_action like 'set_sponsor%' then 'sponsor_profiles' when p_action like 'set_user%' then 'profiles' else 'admin' end,target,'pass',
  jsonb_strip_nulls(jsonb_build_object('status',p_data->>'status','query',case when p_action='lookup' then left(p_data->>'query',40) end)));
 return result;
end $$;

-- Observability: client-reported failures accept the release operations; anonymous auth failures are
-- recorded as system events without credentials or identifiers.
create or replace function public.qb_operation_failure(p_operation text,p_code text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 perform quizbox_private.enforce_budget('failure_events',20,60);
 if p_operation not in ('ATTEMPT_COMPLETION','ATTEMPT_START','CLASS_JOIN','GENERATION','IMPORT','REVIEW','EXTRACTION','SME_REVIEW','PUBLICATION','RESULT_PERSISTENCE','ONBOARDING') then raise exception 'QB_INVALID_EVENT'; end if;
 insert into public.audit_logs(actor_user_id,action,status,details)
 values(auth.uid(),'QB_OP_'||p_operation,'fail',jsonb_build_object('origin','client','error_code',case when p_code ~ '^[A-Z][A-Z0-9_]{2,60}$' then p_code else 'OPERATION_FAILED' end));
end $$;
create function public.qb_auth_failure(p_code text) returns void language plpgsql security definer set search_path='' as $$
begin
 if (select count(*) from public.system_events where event_type='AUTH_FAILURE' and created_at>now()-interval '1 minute')>=120 then return; end if;
 insert into public.system_events(event_type,entity_type,severity,details) values('AUTH_FAILURE','auth','warn',jsonb_build_object('code',case when p_code ~ '^[A-Za-z_ ]{3,60}$' then left(p_code,60) else 'AUTH_FAILED' end));
end $$;

revoke all on all functions in schema quizbox_ops from public,anon,authenticated;
revoke all on function public.qb_school(text,jsonb),public.qb_admin_ops(text,jsonb),public.qb_auth_failure(text) from public,anon;
grant execute on function public.qb_school(text,jsonb),public.qb_admin_ops(text,jsonb) to authenticated;
grant execute on function public.qb_auth_failure(text) to anon,authenticated;
commit;
