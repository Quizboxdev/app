-- In-app activity center, market-aware search and role home payloads. Reuses public.notifications.
-- Notification writes are best-effort: a failure never blocks the business action that raised it.
begin;
create schema if not exists quizbox_ops;
revoke all on schema quizbox_ops from public,anon,authenticated;

alter table public.notifications add column if not exists market_id uuid references public.markets(id);
alter table public.notifications add column if not exists link text check (link is null or link ~ '^/[A-Za-z0-9/_\-?=&.]*$');
create index if not exists notifications_recipient_created_idx on public.notifications(recipient_user_id,created_at desc);

create function quizbox_ops.notify(p_user uuid,p_type text,p_title text,p_message text,p_link text,p_entity_type text default null,p_entity uuid default null,p_market uuid default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.notifications(recipient_user_id,recipient_profile_id,recipient_role,type,title,message,entity_type,entity_id,market_id,link)
 select p.id,p.id,p.role,p_type,left(p_title,150),left(p_message,500),p_entity_type,p_entity,coalesce(p_market,p.default_market_id),p_link from public.profiles p where p.id=p_user;
exception when others then null;
end $$;

create function quizbox_ops.sponsor_members(p_competition uuid) returns setof uuid language sql stable security definer set search_path='' as $$
 select m.user_id from quizbox_competition.drafts d join quizbox_competition.organization_members m on m.sponsor_id=d.sponsor_id and m.active where d.competition_id=p_competition;
$$;

-- Event triggers -------------------------------------------------------------------------------------
create function quizbox_ops.on_assignment_target() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.assignments; s uuid;
begin
 select * into a from public.assignments where id=new.assignment_id; select student_user_id into s from public.class_memberships where id=new.membership_id;
 if s is not null then perform quizbox_ops.notify(s,'ASSIGNMENT_CREATED','New assignment: '||coalesce(a.title,'Assignment'),
  case when a.due_at is not null then 'Due '||to_char(a.due_at,'YYYY-MM-DD HH24:MI')||' UTC' else 'No due date' end,'/student/assessments','assignments',a.id); end if;
 return null;
exception when others then return null;
end $$;
create trigger notify_assignment_target after insert on public.assignment_targets for each row execute function quizbox_ops.on_assignment_target();

create function quizbox_ops.on_result() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.assignments; competition boolean;
begin
 competition:=exists(select 1 from public.assessments x where x.id=new.assessment_id and x.competition_snapshot_id is not null);
 if not competition then
  perform quizbox_ops.notify(new.student_user_id,'RESULT_AVAILABLE','Result available',coalesce(new.percentage::text||'%',''),'/student/results/'||new.attempt_id,'attempts',new.attempt_id);
 end if;
 if new.assignment_id is not null then
  select * into a from public.assignments where id=new.assignment_id;
  if a.teacher_user_id is not null then perform quizbox_ops.notify(a.teacher_user_id,'ASSIGNMENT_SUBMITTED','Submission: '||coalesce(a.title,'Assignment'),'A learner submitted this assignment.','/teacher/submissions/'||new.attempt_id,'attempts',new.attempt_id); end if;
 end if;
 return null;
exception when others then return null;
end $$;
create trigger notify_result after insert on public.assessment_results for each row execute function quizbox_ops.on_result();

create function quizbox_ops.on_review_assignment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform quizbox_ops.notify(new.reviewer_id,'REVIEW_ASSIGNED',case when new.review_kind='senior' then 'Senior QA review assigned' else 'Review assigned' end,'New review work is waiting in your queue.','/review','sme_review_assignments',new.id,new.market_id);
 return null;
exception when others then return null;
end $$;
create trigger notify_review_assignment after insert on public.sme_review_assignments for each row execute function quizbox_ops.on_review_assignment();

create function quizbox_ops.on_review_event() returns trigger language plpgsql security definer set search_path='' as $$
declare w public.sme_review_assignments; primary_reviewer uuid; comp uuid; u uuid;
begin
 select * into w from public.sme_review_assignments where id=new.assignment_id;
 if w.review_kind='senior' then
  select r.reviewer_id into primary_reviewer from public.sme_review_assignments r where r.id=(select x.primary_assignment_id from quizbox_competition.candidates x where x.id=new.candidate_id)
   or r.id=(select e.assignment_id from public.sme_review_events e where e.id=w.prior_review_event_id) limit 1;
  if primary_reviewer is not null then perform quizbox_ops.notify(primary_reviewer,case when new.decision='revision' then 'REVISION_REQUESTED' else 'QA_DECISION' end,
   case when new.decision='revision' then 'Revision requested by senior QA' else 'Senior QA decision: '||new.decision end,coalesce(left(new.review_notes,300),''),'/review','sme_review_events',new.id,w.market_id); end if;
 end if;
 if new.candidate_id is not null then
  select competition_id into comp from quizbox_competition.candidates where id=new.candidate_id;
  for u in select quizbox_ops.sponsor_members(comp) loop perform quizbox_ops.notify(u,'SME_REVIEW_COMPLETE','SME review complete','A candidate question was reviewed: '||new.decision||'.','/sponsor/workspace','candidates',new.candidate_id,w.market_id); end loop;
 end if;
 return null;
exception when others then return null;
end $$;
create trigger notify_review_event after insert on public.sme_review_events for each row execute function quizbox_ops.on_review_event();

create function quizbox_ops.on_earning() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform quizbox_ops.notify(new.reviewer_id,'COMPENSATION_RESOLVED','Review earning recorded',new.final_amount::text||' '||new.currency_code||' ('||new.status||')','/review','reviewer_earnings',new.id);
 return null;
exception when others then return null;
end $$;
create trigger notify_earning after insert on public.reviewer_earnings for each row execute function quizbox_ops.on_earning();

create function quizbox_ops.on_source_approved() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.validation_status='approved' and old.validation_status is distinct from 'approved' and new.uploaded_by is not null then
  perform quizbox_ops.notify(new.uploaded_by,'SOURCE_APPROVED','Source approved: '||coalesce(new.title,'document'),'It can now be used for generation.',
   case when new.source_kind='SPONSOR_SOURCE' then '/sponsor/workspace' else '/admin/markets' end,'source_documents',new.id,new.market_id);
 end if;
 return null;
exception when others then return null;
end $$;
create trigger notify_source_approved after update of validation_status on public.source_documents for each row execute function quizbox_ops.on_source_approved();

create function quizbox_ops.on_generation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('COMPLETED','PARTIAL','FAILED') and old.status is distinct from new.status then
  perform quizbox_ops.notify(new.created_by,case when new.status='FAILED' then 'GENERATION_FAILED' else 'GENERATION_COMPLETE' end,
   case when new.status='FAILED' then 'Generation failed' else 'Generation complete' end,'Status: '||new.status||coalesce(' ('||new.error_code||')',''),'/sponsor/workspace','generation_jobs',new.id);
 end if;
 return null;
exception when others then return null;
end $$;
create trigger notify_generation after update of status on quizbox_competition.generation_jobs for each row execute function quizbox_ops.on_generation();

create function quizbox_ops.on_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
 for u in select quizbox_ops.sponsor_members(new.competition_id) loop perform quizbox_ops.notify(u,'COMPETITION_READY','Competition ready to publish','An immutable snapshot was created. Review readiness and publish.','/sponsor/workspace','competitions',new.competition_id); end loop;
 return null;
exception when others then return null;
end $$;
create trigger notify_snapshot after insert on quizbox_competition.snapshots for each row execute function quizbox_ops.on_snapshot();

create function quizbox_ops.on_competition_status() returns trigger language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
 if new.status is distinct from old.status and new.status in ('PUBLISHED','CLOSED','ARCHIVED') then
  for u in select quizbox_ops.sponsor_members(new.id) loop perform quizbox_ops.notify(u,'COMPETITION_'||new.status,'Competition '||lower(new.status)||': '||new.title,'','/sponsor/workspace','competitions',new.id); end loop;
 end if;
 return null;
exception when others then return null;
end $$;
create trigger notify_competition_status after update of status on public.competitions for each row execute function quizbox_ops.on_competition_status();

create function quizbox_ops.on_official_result() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform quizbox_ops.notify(new.participant_id,'COMPETITION_RESULT','Competition result: '||new.score||'/'||new.possible_score,'Your official result is available.','/competition/results/'||new.attempt_id,'attempts',new.attempt_id);
 return null;
exception when others then return null;
end $$;
create trigger notify_official_result after insert on quizbox_competition.official_results for each row execute function quizbox_ops.on_official_result();

-- Live alerts that depend on time/state are computed on read, never stored.
create function quizbox_ops.live_alerts(p_user uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me public.profiles; alerts jsonb:='[]';
begin
 select * into me from public.profiles where id=p_user; if me.id is null then return alerts; end if;
 alerts:=alerts||coalesce((select jsonb_agg(jsonb_build_object('id','due:'||a.id,'type','ASSIGNMENT_DUE','title','Due soon: '||a.title,'message','Due '||to_char(a.due_at,'YYYY-MM-DD HH24:MI')||' UTC','link','/student/assessments','created_at',a.due_at,'read',false,'live',true))
  from public.assignments a join public.assignment_targets t on t.assignment_id=a.id join public.class_memberships m on m.id=t.membership_id
  where m.student_user_id=p_user and a.status='published' and a.due_at between now() and now()+interval '48 hours'
   and not exists(select 1 from public.assessment_results r where r.assignment_id=a.id and r.student_user_id=p_user)),'[]');
 alerts:=alerts||coalesce((select jsonb_agg(jsonb_build_object('id','open:'||r.competition_id,'type','COMPETITION_OPEN','title','Competition open: '||c.title,'message','You are registered and it is open now.','link','/competition/participate/'||r.competition_id,'created_at',(d.configuration->>'startsAt')::timestamptz,'read',false,'live',true))
  from quizbox_competition.registrations r join quizbox_competition.drafts d on d.competition_id=r.competition_id join public.competitions c on c.id=r.competition_id
  where r.participant_id=p_user and r.eligible and c.status='PUBLISHED' and now() between (d.configuration->>'startsAt')::timestamptz and (d.configuration->>'endsAt')::timestamptz
   and not exists(select 1 from quizbox_competition.official_results o where o.competition_id=r.competition_id and o.participant_id=p_user)),'[]');
 alerts:=alerts||coalesce((select jsonb_agg(jsonb_build_object('id','weak:'||x.class_id,'type','WEAK_CLASS','title','Class needs attention: '||x.class_name,'message',round(x.acc)||'% accuracy over the last 14 days','link','/teacher','created_at',now(),'read',false,'live',true))
  from (select c.id class_id,c.class_name,avg(case when e.is_correct then 100 else 0 end) acc,count(*) n from public.classes c join public.learning_events e on e.class_id=c.id and e.occurred_at>now()-interval '14 days'
   where c.teacher_user_id=p_user and c.status::text='active' group by 1,2) x where x.n>=10 and x.acc<50),'[]');
 if quizbox_sme.has_capability('super_admin') or quizbox_sme.has_capability('content_admin') then
  alerts:=alerts||coalesce((select jsonb_agg(z) from (
   select jsonb_build_object('id','src','type','SOURCE_AWAITING_APPROVAL','title',count(*)||' source(s) awaiting approval','message','Review rights, provenance and extracted text.','link','/admin/markets','created_at',max(created_at),'read',false,'live',true) z
    from public.source_documents where validation_status='review' having count(*)>0
   union all select jsonb_build_object('id','comp','type','UNRESOLVED_COMPENSATION','title',count(*)||' review(s) without compensation policy','message','Configure a policy version for the affected market/tier.','link','/admin/compensation','created_at',now(),'read',false,'live',true)
    from quizbox_competition.review_events where policy_context_snapshot->>'compensation_status'='COMPENSATION_UNRESOLVED' having count(*)>0
   union all select jsonb_build_object('id','backlog','type','REVIEW_BACKLOG','title',count(*)||' open review assignment(s)','message','Oldest open since '||to_char(min(assigned_at),'YYYY-MM-DD'),'link','/review','created_at',min(assigned_at),'read',false,'live',true)
    from public.sme_review_assignments where review_completed_at is null having count(*)>0
   union all select jsonb_build_object('id','ready:'||m.id,'type','MARKET_BLOCKED','title','Market not ready: '||m.name,'message',(quizbox_market.market_readiness(m.id)->'blockers')::text,'link','/admin/market-setup','created_at',now(),'read',false,'live',true)
    from public.markets m where m.status in ('CONFIGURING','READY') and not (quizbox_market.market_readiness(m.id)->>'ready')::boolean) q),'[]');
 end if;
 return alerts;
end $$;

create function public.qb_notifications(p_action text default 'list',p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); stored jsonb;
begin
 if me is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_action='mark_read' then update public.notifications set read_at=coalesce(read_at,now()) where id=(p_data->>'id')::uuid and recipient_user_id=me; return jsonb_build_object('ok',true);
 elsif p_action='mark_all_read' then update public.notifications set read_at=now() where recipient_user_id=me and read_at is null; return jsonb_build_object('ok',true);
 elsif p_action<>'list' then raise exception 'INVALID_NOTIFICATION_ACTION'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'type',n.type,'title',n.title,'message',n.message,'link',n.link,'created_at',n.created_at,'read',n.read_at is not null,'live',false,'market',(select name from public.markets where id=n.market_id)) order by n.created_at desc),'[]')
  into stored from (select * from public.notifications where recipient_user_id=me and (not coalesce((p_data->>'unread_only')::boolean,false) or read_at is null) order by created_at desc limit 50) n;
 return jsonb_build_object('unread',(select count(*) from public.notifications where recipient_user_id=me and read_at is null),'live',quizbox_ops.live_alerts(me),'items',stored);
end $$;

-- Market-aware search. Every branch applies the same authorization the source screens use.
create function public.qb_search(p_query text,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me public.profiles; q text; lim integer:=least(greatest(coalesce(p_limit,20),1),50); r jsonb:='[]'; sup boolean; role text;
begin
 select * into me from public.profiles where id=auth.uid() and lower(status::text)='active'; if me.id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if length(btrim(coalesce(p_query,'')))<2 then return '[]'; end if;
 q:='%'||replace(replace(replace(btrim(left(p_query,80)),'\','\\'),'%','\%'),'_','\_')||'%'; sup:=quizbox_market.is_super(); role:=lower(me.role::text);
 if sup then
  r:=r||coalesce((select jsonb_agg(x) from (select jsonb_build_object('kind','user','title',p.full_name,'subtitle',p.role||' · '||coalesce((select name from public.markets where id=p.primary_market_id),'no market')||' · '||p.status,'href','/admin/operations?user='||p.id) x from public.profiles p where p.full_name ilike q or p.email ilike q limit lim) s),'[]')
   ||coalesce((select jsonb_agg(x) from (select jsonb_build_object('kind','sponsor','title',s.organization_name,'subtitle',coalesce(s.status,'')||' · '||coalesce(s.verification_status,''),'href','/admin/operations?sponsor='||s.id) x from public.sponsor_profiles s where s.organization_name ilike q limit lim) s),'[]')
   ||coalesce((select jsonb_agg(x) from (select jsonb_build_object('kind','source','title',d.title,'subtitle',d.source_kind||' · '||d.validation_status,'href','/admin/markets') x from public.source_documents d where d.title ilike q limit lim) s),'[]')
   ||coalesce((select jsonb_agg(x) from (select jsonb_build_object('kind','competition','title',c.title,'subtitle',coalesce(c.status,''),'href','/admin/competitions/oversight') x from public.competitions c where c.title ilike q limit lim) s),'[]')
   ||coalesce((select jsonb_agg(x) from (select jsonb_build_object('kind','market','title',m.name,'subtitle',m.status||case when m.is_test then ' · test' else '' end,'href','/admin/market-setup') x from public.markets m where m.name ilike q limit lim) s),'[]');
  return r;
 end if;
 if role in ('student','teacher') then
  r:=r||coalesce((select jsonb_agg(x) from (select jsonb_build_object('kind',case n.node_type when 'subject' then 'subject' when 'learning_indicator' then 'indicator' else 'topic' end,'title',n.title,'subtitle',coalesce(n.code,'')||' · '||n.node_type,
    'href',case when role='teacher' then '/teacher/assignments' else '/student/assessments' end) x
   from public.curriculum_nodes n where n.is_active and n.node_type in ('subject','strand','sub_strand','learning_indicator') and (n.title ilike q or n.code ilike q) and quizbox_market.node_allowed(n.id)
    and (role='teacher' or n.node_type='subject' or coalesce(n.canonical_grade_code,n.grade_code) is null or coalesce(n.canonical_grade_code,n.grade_code)=quizbox_market.student_grade_code(me.id)) limit lim) s),'[]');
 end if;
 if role='student' then
  r:=r||coalesce((select jsonb_agg(jsonb_build_object('kind','practice','title',coalesce(a.subject_name,'Assessment'),'subtitle',a.assessment_type,'href','/student/assessments'))
    from public.qb_list_available_assessments() a where a.subject_name ilike q),'[]');
 end if;
 if role='teacher' then
  r:=r||coalesce((select jsonb_agg(x) from (select jsonb_build_object('kind','question','title',left(qq.question_text,120),'subtitle',coalesce(qq.subject_code,'')||' · '||coalesce(qq.canonical_grade_code,''),'href','/teacher/question-banks') x
    from public.questions qq where qq.status::text='active' and qq.validation_status='approved' and qq.question_text ilike q and quizbox_market.question_allowed(qq.id) limit lim) s),'[]')
   ||coalesce((select jsonb_agg(x) from (select jsonb_build_object('kind','assignment','title',a.title,'subtitle',a.status::text||coalesce(' · due '||to_char(a.due_at,'YYYY-MM-DD'),''),'href','/teacher/assignments') x
    from public.assignments a where a.teacher_user_id=me.id and a.title ilike q limit lim) s),'[]');
 end if;
 if role in ('student','teacher') then
  r:=r||coalesce((select jsonb_agg(jsonb_build_object('kind','competition','title',c->>'title','subtitle',coalesce(c->>'scope',''),'href','/competition/participate/'||(c->>'competition_id')))
    from jsonb_array_elements(coalesce(quizbox_competition.dispatch('discover',null,'{}'),'[]')) c where c->>'title' ilike q),'[]');
 end if;
 if exists(select 1 from public.sme_profiles where user_id=me.id and active) then
  r:=r||coalesce((select jsonb_agg(x) from (select jsonb_build_object('kind','review','title',coalesce(left(qq.question_text,100),'Candidate review'),'subtitle',w.review_kind||' · '||case when w.review_completed_at is null then 'open' else 'completed' end,'href','/review') x
    from public.sme_review_assignments w left join public.questions qq on qq.id=w.question_id left join quizbox_competition.candidates cd on cd.id=w.candidate_id
    where w.reviewer_id=me.id and (qq.question_text ilike q or cd.payload->>'stem' ilike q) limit lim) s),'[]');
 end if;
 if role='sponsor' then
  r:=r||coalesce((select jsonb_agg(x) from (select jsonb_build_object('kind','competition','title',d.configuration->>'title','subtitle',coalesce(c.status,'DRAFT'),'href','/sponsor/workspace') x
    from quizbox_competition.drafts d join quizbox_competition.organization_members m on m.sponsor_id=d.sponsor_id and m.user_id=me.id and m.active left join public.competitions c on c.id=d.competition_id
    where d.configuration->>'title' ilike q limit lim) s),'[]')
   ||coalesce((select jsonb_agg(x) from (select jsonb_build_object('kind','source','title',sd.title,'subtitle',doc.ingestion_status||' · '||sd.validation_status,'href','/sponsor/workspace') x
    from quizbox_competition.documents doc join public.source_documents sd on sd.id=doc.id join quizbox_competition.drafts d on d.competition_id=doc.competition_id
    join quizbox_competition.organization_members m on m.sponsor_id=d.sponsor_id and m.user_id=me.id and m.active where sd.title ilike q limit lim) s),'[]');
 end if;
 return r;
end $$;

revoke all on all functions in schema quizbox_ops from public,anon,authenticated;
revoke all on function public.qb_notifications(text,jsonb),public.qb_search(text,integer) from public,anon;
grant execute on function public.qb_notifications(text,jsonb),public.qb_search(text,integer) to authenticated;
commit;
