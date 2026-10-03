-- Content quality operations, stakeholder analytics and role home payloads. Read-only aggregation
-- except flag/resolve, which only write content_reports (never questions).
begin;

-- Content quality ------------------------------------------------------------------------------------
create function quizbox_ops.question_signals(p_min_responses integer default 5) returns table(question_id uuid,responses bigint,accuracy numeric,started bigint,abandoned bigint,revisions bigint,disputes bigint,flags text[])
language sql stable security definer set search_path='' as $$
 with r as (select question_id,count(*) n,avg(case when is_correct then 1.0 else 0 end) acc from public.responses where is_correct is not null group by 1),
 a as (select aq.question_id,count(distinct t.id) started,count(distinct t.id) filter (where t.submitted_at is null and coalesce(t.expires_at,t.started_at+interval '1 day')<now()) abandoned
  from public.attempts t join public.assessment_questions aq on aq.assessment_id=t.assessment_id group by 1),
 v as (select question_id,count(*) filter (where decision='revision') revisions from public.sme_review_events where question_id is not null group by 1),
 d as (select target_id question_id,count(*) disputes from public.content_reports where target_type='question' and report_type in ('DISPUTE','QUESTION_ERROR') group by 1)
 select q.id,coalesce(r.n,0),round(r.acc,3),coalesce(a.started,0),coalesce(a.abandoned,0),coalesce(v.revisions,0),coalesce(d.disputes,0),
  array_remove(array[
   case when coalesce(r.n,0)>=p_min_responses and r.acc<0.2 then 'VERY_LOW_ACCURACY' end,
   case when coalesce(r.n,0)>=p_min_responses and r.acc>0.97 then 'VERY_HIGH_ACCURACY' end,
   case when coalesce(a.started,0)>=p_min_responses and a.abandoned::numeric/a.started>0.3 then 'FREQUENT_ABANDONMENT' end,
   case when coalesce(v.revisions,0)>=2 then 'REPEATED_REVISIONS' end,
   case when coalesce(d.disputes,0)>=1 then 'DISPUTED' end],null)
 from public.questions q left join r on r.question_id=q.id left join a on a.question_id=q.id left join v on v.question_id=q.id left join d on d.question_id=q.id;
$$;

create function public.qb_content_quality(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare sup boolean:=quizbox_market.is_super(); rep public.content_reports;
begin
 if not (sup or quizbox_sme.has_capability('content_admin')) then raise exception 'QB_CONTENT_ACCESS_DENIED' using errcode='42501'; end if;
 if p_action='summary' then
  return jsonb_build_object(
   'generated',(select count(*) from public.questions q where q.validation_status in ('generated','draft') and (sup or quizbox_market.question_allowed(q.id))),
   'awaiting_review',(select count(*) from public.questions q where q.validation_status='review' and (sup or quizbox_market.question_allowed(q.id))),
   'revision_required',(select count(*) from public.questions q where q.validation_status='needs_revision' and (sup or quizbox_market.question_allowed(q.id))),
   'approved',(select count(*) from public.questions q where q.validation_status='approved' and q.status::text<>'active' and (sup or quizbox_market.question_allowed(q.id))),
   'published',(select count(*) from public.questions q where q.validation_status='approved' and q.status::text='active' and (sup or quizbox_market.question_allowed(q.id))),
   'rejected',(select count(*) from public.questions q where q.validation_status='rejected' and (sup or quizbox_market.question_allowed(q.id))),
   'disputed',(select count(distinct target_id) from public.content_reports where target_type='question' and coalesce(status,'open')='open' and report_type in ('DISPUTE','QUESTION_ERROR')),
   'quality_queue',(select count(*) from public.content_reports where target_type='question' and report_type='QUALITY_REVIEW' and coalesce(status,'open')='open'),
   'candidates',(select jsonb_object_agg(status,n) from (select status,count(*) n from quizbox_competition.candidates group by 1) c));
 elsif p_action='signals' then
  return coalesce((select jsonb_agg(jsonb_build_object('question_id',s.question_id,'question',left(q.question_text,140),'subject',q.subject_code,'grade',q.canonical_grade_code,'status',q.validation_status||'/'||q.status,
    'responses',s.responses,'accuracy',s.accuracy,'started',s.started,'abandoned',s.abandoned,'revisions',s.revisions,'disputes',s.disputes,'flags',to_jsonb(s.flags)) order by cardinality(s.flags) desc,s.responses desc)
   from quizbox_ops.question_signals(coalesce((p_data->>'min_responses')::integer,5)) s join public.questions q on q.id=s.question_id
   where (cardinality(s.flags)>0 or not coalesce((p_data->>'flagged_only')::boolean,true)) and (sup or quizbox_market.question_allowed(q.id)) limit 200),'[]');
 elsif p_action='flag' then
  if not exists(select 1 from public.questions q where q.id=(p_data->>'question_id')::uuid and (sup or quizbox_market.question_allowed(q.id))) then raise exception 'QB_CONTENT_SOURCE_DENIED' using errcode='42501'; end if;
  insert into public.content_reports(reporter_user_id,target_type,target_id,report_type,description,status)
  values(auth.uid(),'question',(p_data->>'question_id')::uuid,'QUALITY_REVIEW',left(coalesce(p_data->>'reason','Quality signal'),500),'open') returning * into rep;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details) values(auth.uid(),'QB_QUALITY_FLAG','questions',rep.target_id,'pass',jsonb_build_object('report_id',rep.id));
  return to_jsonb(rep);
 elsif p_action='queue' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'question_id',c.target_id,'question',left(q.question_text,140),'type',c.report_type,'reason',c.description,'created_at',c.created_at) order by c.created_at)
   from public.content_reports c join public.questions q on q.id=c.target_id where c.target_type='question' and coalesce(c.status,'open')='open' and c.report_type in ('QUALITY_REVIEW','DISPUTE','QUESTION_ERROR')
   and (sup or quizbox_market.question_allowed(q.id))),'[]');
 elsif p_action='resolve' then
  update public.content_reports set status='resolved',resolved_by=auth.uid(),resolved_at=now() where id=(p_data->>'report_id')::uuid and coalesce(status,'open')='open' returning * into rep;
  if rep.id is null then raise exception 'REPORT_NOT_OPEN'; end if;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details) values(auth.uid(),'QB_QUALITY_RESOLVED','content_reports',rep.id,'pass',jsonb_build_object('note',left(p_data->>'note',300)));
  return to_jsonb(rep);
 end if;
 raise exception 'INVALID_QUALITY_ACTION';
end $$;

-- Learners may dispute a question they have answered; it enters the quality queue.
create function public.qb_report_question(p_question uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare rep public.content_reports;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if not exists(select 1 from public.responses r join public.attempts t on t.id=r.attempt_id where r.question_id=p_question and t.student_user_id=auth.uid()) then raise exception 'QB_REPORT_REQUIRES_ATTEMPT' using errcode='42501'; end if;
 if length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'QB_REPORT_REASON_REQUIRED'; end if;
 insert into public.content_reports(reporter_user_id,target_type,target_id,report_type,description,status) values(auth.uid(),'question',p_question,'DISPUTE',btrim(p_reason),'open')
 on conflict do nothing returning * into rep;
 return coalesce(to_jsonb(rep),'{}'::jsonb);
end $$;

-- Analytics ------------------------------------------------------------------------------------------
create function quizbox_ops.student_insights(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'by_subject',coalesce((select jsonb_agg(jsonb_build_object('subject',x.subject,'mastery',x.m,'topics',x.n) order by x.m) from (select coalesce(n.subject_code,'General') subject,round(avg(mr.mastery_score),1) m,count(*) n
    from public.mastery_records mr join public.curriculum_nodes n on n.id=mr.curriculum_node_id where mr.student_user_id=p_user group by 1) x),'[]'),
  'weak_topics',coalesce((select jsonb_agg(jsonb_build_object('topic',x.title,'code',x.code,'mastery',x.m) order by x.m) from (select n.title,n.code,round(mr.mastery_score,1) m
    from public.mastery_records mr join public.curriculum_nodes n on n.id=mr.curriculum_node_id where mr.student_user_id=p_user and mr.mastery_score<60 order by mr.mastery_score limit 5) x),'[]'),
  'proficiency',coalesce((select jsonb_object_agg(coalesce(proficiency_state,'Unrated'),n) from (select proficiency_state,count(*) n from public.mastery_records where student_user_id=p_user group by 1) x),'{}'),
  'recent_improvement',(select round(avg(p) filter (where rn<=5)-avg(p) filter (where rn between 6 and 10),1) from (select percentage p,row_number() over(order by submitted_at desc) rn from public.assessment_results where student_user_id=p_user) x),
  'history',coalesce((select jsonb_agg(jsonb_build_object('attempt_id',r.attempt_id,'subject',coalesce(r.subject_code,''),'percentage',r.percentage,'submitted_at',r.submitted_at) order by r.submitted_at desc) from (select * from public.assessment_results where student_user_id=p_user order by submitted_at desc limit 10) r),'[]'));
$$;
create function public.qb_student_insights() returns jsonb language sql stable security definer set search_path='' as $$ select quizbox_ops.student_insights(auth.uid()); $$;

create function public.qb_teacher_insights() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 return (with my as (select id,class_name from public.classes where teacher_user_id=auth.uid() and status::text='active')
 select jsonb_build_object(
  'assignment_completion',coalesce((select jsonb_agg(jsonb_build_object('assignment',a.title,'class',(select class_name from my where id=a.class_id),'targets',(select count(*) from public.assignment_targets t where t.assignment_id=a.id),
    'submitted',(select count(distinct r.student_user_id) from public.assessment_results r where r.assignment_id=a.id),'due_at',a.due_at) order by a.created_at desc)
   from (select * from public.assignments where teacher_user_id=auth.uid() and status='published' order by created_at desc limit 20) a),'[]'),
  'question_difficulty',coalesce((select jsonb_agg(jsonb_build_object('question',left(q.question_text,100),'responses',x.n,'accuracy',x.acc) order by x.acc) from
   (select r.question_id,count(*) n,round(avg(case when r.is_correct then 100 else 0 end),1) acc from public.responses r join public.assignments a on a.id=r.assignment_id where a.teacher_user_id=auth.uid() group by 1 having count(*)>=3 order by 3 limit 10) x
   join public.questions q on q.id=x.question_id),'[]'),
  'student_progress',coalesce((select jsonb_agg(jsonb_build_object('student',p.full_name,'results',x.n,'average',x.avg_p,'last',x.last_p) order by x.avg_p) from
   (select r.student_user_id,count(*) n,round(avg(r.percentage),1) avg_p,(array_agg(r.percentage order by r.submitted_at desc))[1] last_p from public.assessment_results r where r.class_id in (select id from my) group by 1) x
   join public.profiles p on p.id=x.student_user_id),'[]'),
  'weak_indicators',coalesce((select jsonb_agg(to_jsonb(w) order by w.average_accuracy) from public.qb_teacher_indicator_summary(array(select id from my)) w where (select count(*) from my)>0),'[]')));
end
$$;

create function public.qb_platform_insights() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode='42501'; end if;
 return jsonb_build_object(
  'adoption',coalesce((select jsonb_agg(jsonb_build_object('market',m.name,'test',m.is_test,'users',(select count(*) from public.profiles p where p.primary_market_id=m.id),
    'active_30d',(select count(distinct t.student_user_id) from public.attempts t join public.profiles p on p.id=t.student_user_id where p.primary_market_id=m.id and t.started_at>now()-interval '30 days')) order by m.name) from public.markets m),'[]'),
  'content_growth',coalesce((select jsonb_agg(jsonb_build_object('week',w,'questions',n) order by w) from (select to_char(date_trunc('week',created_at),'YYYY-MM-DD') w,count(*) n from public.questions where created_at>now()-interval '8 weeks' group by 1) x),'[]'),
  'review_throughput',coalesce((select jsonb_agg(jsonb_build_object('week',w,'reviews',n) order by w) from (select to_char(date_trunc('week',review_completed_at),'YYYY-MM-DD') w,count(*) n from public.sme_review_events where review_completed_at>now()-interval '8 weeks' group by 1) x),'[]'),
  'competitions',(select jsonb_object_agg(coalesce(status,'DRAFT'),n) from (select status,count(*) n from public.competitions group by 1) x),
  'source_backlog',(select count(*) from public.source_documents where validation_status='review'),
  'active_users_7d',(select count(distinct student_user_id) from public.attempts where started_at>now()-interval '7 days'));
end $$;

-- Role home payloads ---------------------------------------------------------------------------------
create function public.qb_home() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me public.profiles; role text; s jsonb:='[]'; ins jsonb; mk public.markets; sme boolean;
begin
 select * into me from public.profiles where id=auth.uid() and lower(status::text)='active'; if me.id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 role:=lower(me.role::text); select * into mk from public.markets where id=me.default_market_id;
 sme:=exists(select 1 from public.sme_profiles where user_id=me.id and active and reviewer_status='verified');
 if quizbox_market.is_super() then
  s:=s||jsonb_build_array(jsonb_build_object('key','platform','title','Platform','kind','stats','stats',jsonb_build_array(
    jsonb_build_object('label','Active markets','value',(select count(*) from public.markets where status='ACTIVE' and not is_test)),
    jsonb_build_object('label','Users','value',(select count(*) from public.profiles)),
    jsonb_build_object('label','Active curricula','value',(select count(*) from public.market_curricula where active)),
    jsonb_build_object('label','Sponsors','value',(select count(*) from public.sponsor_profiles)),
    jsonb_build_object('label','Active competitions','value',(select count(*) from public.competitions where status='PUBLISHED')),
    jsonb_build_object('label','Review backlog','value',(select count(*) from public.sme_review_assignments where review_completed_at is null)),
    jsonb_build_object('label','Unresolved source items','value',(select count(*) from public.market_attribution_issues)+(select count(*) from public.source_documents where validation_status='review')),
    jsonb_build_object('label','Unresolved compensation','value',(select count(*) from quizbox_competition.review_events where policy_context_snapshot->>'compensation_status'='COMPENSATION_UNRESOLVED'))),'href','/admin/market-setup'),
   jsonb_build_object('key','markets','title','Users and readiness by market','kind','list','items',coalesce((select jsonb_agg(jsonb_build_object('title',m.name||case when m.is_test then ' (test)' else '' end,
     'subtitle',m.status||' · '||(select count(*) from public.profiles p where p.primary_market_id=m.id)||' users','meta',case when (quizbox_market.market_readiness(m.id)->>'ready')::boolean then 'Ready' else (quizbox_market.market_readiness(m.id)->'blockers'->>0) end,'href','/admin/market-setup') order by m.name) from public.markets m),'[]')),
   jsonb_build_object('key','notices','title','Security and release notices','kind','list','items',(
     select coalesce(jsonb_agg(x),'[]') from (
      select jsonb_build_object('title','Test markets are visible at signup','subtitle','Disable TEST_MARKETS_VISIBLE outside test projects','href','/admin/market-setup') x where exists(select 1 from public.feature_flags where feature_code='TEST_MARKETS_VISIBLE' and enabled)
      union all select jsonb_build_object('title',count(*)||' pending country change request(s)','href','/admin/market-setup') from public.market_change_requests where status='PENDING' having count(*)>0
      union all select jsonb_build_object('title',count(*)||' ambiguous content item(s) awaiting attribution review','href','/admin/markets') from public.market_attribution_issues having count(*)>0
      union all select jsonb_build_object('title','Enable leaked-password protection in Supabase Auth before production','subtitle','Release checklist step 4','href','/admin/operations')) z)));
  return jsonb_build_object('role','super_admin','market',mk.name,'sections',s);
 end if;
 if role='student' then
  ins:=quizbox_ops.student_insights(me.id);
  s:=s||jsonb_build_array(
   jsonb_build_object('key','profile','title','My learning','kind','stats','stats',jsonb_build_array(jsonb_build_object('label','Country / market','value',coalesce(mk.name,'-')),
     jsonb_build_object('label','Grade','value',coalesce(quizbox_market.student_grade_code(me.id),'-')),
     jsonb_build_object('label','Subjects','value',coalesce((select array_to_string(subjects,', ') from public.student_profiles where user_id=me.id and cardinality(subjects)>0 limit 1),'All')),
     jsonb_build_object('label','Recent change','value',coalesce((ins->>'recent_improvement')||' pts','-')))),
   jsonb_build_object('key','continue','title','Continue practice','kind','list','empty','Nothing in progress.','items',coalesce((select jsonb_agg(jsonb_build_object('title','Resume '||coalesce(a.subject_name,'assessment'),'subtitle','Started '||to_char(t.started_at,'YYYY-MM-DD HH24:MI'),'href','/student/attempt/'||t.id))
     from public.attempts t join public.assessments a on a.id=t.assessment_id where t.student_user_id=me.id and t.submitted_at is null and coalesce(t.expires_at,now()+interval '1 minute')>now() and a.competition_snapshot_id is null),'[]')),
   jsonb_build_object('key','due','title','Assignments due','kind','list','empty','No assignments due.','items',coalesce((select jsonb_agg(jsonb_build_object('title',a.title,'subtitle',coalesce('Due '||to_char(a.due_at,'YYYY-MM-DD'),'No due date'),'href','/student/assessments') order by a.due_at nulls last)
     from public.assignments a join public.assignment_targets t on t.assignment_id=a.id join public.class_memberships m on m.id=t.membership_id
     where m.student_user_id=me.id and a.status='published' and (a.due_at is null or a.due_at>now()) and not exists(select 1 from public.assessment_results r where r.assignment_id=a.id and r.student_user_id=me.id)),'[]')),
   jsonb_build_object('key','competitions','title','Competitions','kind','list','empty','No active competitions.','items',coalesce((select jsonb_agg(jsonb_build_object('title',c->>'title','subtitle','Starts '||coalesce(c->>'starts_at',''),'href','/competition/participate/'||(c->>'competition_id')))
     from jsonb_array_elements(coalesce(quizbox_competition.dispatch('discover',null,'{}'),'[]')) c),'[]')),
   jsonb_build_object('key','results','title','Recent results','kind','list','empty','No results yet.','items',coalesce((select jsonb_agg(jsonb_build_object('title',coalesce(h->>'subject','Assessment'),'subtitle',(h->>'percentage')||'%','href','/student/results/'||(h->>'attempt_id'))) from jsonb_array_elements(ins->'history') h),'[]')),
   jsonb_build_object('key','proficiency','title','Proficiency','kind','stats','stats',coalesce((select jsonb_agg(jsonb_build_object('label',key,'value',value)) from jsonb_each(ins->'proficiency')),'[]')),
   jsonb_build_object('key','weak','title','Recommended topics','kind','list','empty','No weak topics yet. Keep practising.','items',coalesce((select jsonb_agg(jsonb_build_object('title',w->>'topic','subtitle',(w->>'mastery')||'% mastery','href','/student/assessments')) from jsonb_array_elements(ins->'weak_topics') w),'[]')));
 elsif role='teacher' then
  s:=s||jsonb_build_array(
   jsonb_build_object('key','summary','title','Teaching overview','kind','stats','stats',jsonb_build_array(
     jsonb_build_object('label','Market','value',coalesce(mk.name,'-')),
     jsonb_build_object('label','Classes','value',(select count(*) from public.classes where teacher_user_id=me.id and status::text='active')),
     jsonb_build_object('label','Students','value',(select count(distinct m.student_user_id) from public.class_memberships m join public.classes c on c.id=m.class_id where c.teacher_user_id=me.id and m.status::text='active')),
     jsonb_build_object('label','Average (30 days)','value',coalesce((select round(avg(r.percentage),1)||'%' from public.assessment_results r join public.classes c on c.id=r.class_id where c.teacher_user_id=me.id and r.submitted_at>now()-interval '30 days'),'-')),
     jsonb_build_object('label','Learners below 50%','value',(select count(*) from (select r.student_user_id from public.assessment_results r join public.classes c on c.id=r.class_id where c.teacher_user_id=me.id group by 1 having avg(r.percentage)<50) x))),
    'actions',jsonb_build_array(jsonb_build_object('label','Create assignment','href','/teacher/assignments'),jsonb_build_object('label','Classes','href','/teacher/classes'),jsonb_build_object('label','Curriculum and questions','href','/teacher/question-banks'))),
   jsonb_build_object('key','pending','title','Open assignments','kind','list','empty','No open assignments.','items',coalesce((select jsonb_agg(jsonb_build_object('title',a.title,'subtitle',(select count(distinct r.student_user_id) from public.assessment_results r where r.assignment_id=a.id)||'/'||(select count(*) from public.assignment_targets t where t.assignment_id=a.id)||' submitted','meta',coalesce('Due '||to_char(a.due_at,'YYYY-MM-DD'),''),'href','/teacher/assignments'))
     from (select * from public.assignments where teacher_user_id=me.id and status='published' and (due_at is null or due_at>now()) order by due_at nulls last limit 10) a),'[]')),
   jsonb_build_object('key','submissions','title','Recent submissions','kind','list','empty','No submissions in the last 7 days.','items',coalesce((select jsonb_agg(jsonb_build_object('title',p.full_name,'subtitle',a.title||' · '||r.percentage||'%','href','/teacher/submissions/'||r.attempt_id) order by r.submitted_at desc)
     from (select * from public.assessment_results where submitted_at>now()-interval '7 days' and assignment_id in (select id from public.assignments where teacher_user_id=me.id) order by submitted_at desc limit 10) r join public.assignments a on a.id=r.assignment_id join public.profiles p on p.id=r.student_user_id),'[]')),
   jsonb_build_object('key','weak','title','Weak indicators','kind','list','empty','Not enough learning data yet.','items',coalesce((select jsonb_agg(jsonb_build_object('title',w->>'title','subtitle',(w->>'average_accuracy')||'% accuracy · '||(w->>'learner_count')||' learners','href','/teacher')) from jsonb_array_elements(public.qb_teacher_insights()->'weak_indicators') w where (w->>'average_accuracy')::numeric<68),'[]')));
 elsif role='sponsor' then
  s:=s||jsonb_build_array(
   jsonb_build_object('key','competitions','title','Competitions','kind','stats','stats',coalesce((select jsonb_agg(jsonb_build_object('label',st,'value',n)) from (select st,count(*) n from (
     select case when c.status='ARCHIVED' then 'Archived' when c.status='CLOSED' or now()>(d.configuration->>'endsAt')::timestamptz and c.status='PUBLISHED' then 'Completed' when c.status='PUBLISHED' and now()<(d.configuration->>'startsAt')::timestamptz then 'Scheduled' when c.status='PUBLISHED' then 'Active' else 'Draft' end st
     from quizbox_competition.drafts d join quizbox_competition.organization_members om on om.sponsor_id=d.sponsor_id and om.user_id=me.id and om.active left join public.competitions c on c.id=d.competition_id) x group by 1) y),'[]'),
    'actions',jsonb_build_array(jsonb_build_object('label','Create competition','href','/sponsor/workspace'))),
   jsonb_build_object('key','engagement','title','Participation','kind','stats','stats',jsonb_build_array(
     jsonb_build_object('label','Registrations','value',(select count(*) from quizbox_competition.registrations r join quizbox_competition.drafts d on d.competition_id=r.competition_id join quizbox_competition.organization_members om on om.sponsor_id=d.sponsor_id and om.user_id=me.id and om.active where r.eligible)),
     jsonb_build_object('label','Attempts started','value',(select count(*) from quizbox_competition.participations p join quizbox_competition.drafts d on d.competition_id=p.competition_id join quizbox_competition.organization_members om on om.sponsor_id=d.sponsor_id and om.user_id=me.id and om.active)),
     jsonb_build_object('label','Completed','value',(select count(*) from quizbox_competition.official_results o join quizbox_competition.drafts d on d.competition_id=o.competition_id join quizbox_competition.organization_members om on om.sponsor_id=d.sponsor_id and om.user_id=me.id and om.active)))),
   jsonb_build_object('key','blockers','title','Pending content and review blockers','kind','list','empty','No blockers on draft competitions.','items',coalesce((select jsonb_agg(jsonb_build_object('title',d.configuration->>'title','subtitle',array_to_string(array(select jsonb_array_elements_text(quizbox_competition.publication_blockers(d.competition_id,false))),', '),'href','/sponsor/workspace'))
     from quizbox_competition.drafts d join quizbox_competition.organization_members om on om.sponsor_id=d.sponsor_id and om.user_id=me.id and om.active
     where not exists(select 1 from quizbox_competition.snapshots sn where sn.competition_id=d.competition_id) and jsonb_array_length(quizbox_competition.publication_blockers(d.competition_id,false))>0),'[]')));
 end if;
 if sme then
  s:=s||jsonb_build_array(
   jsonb_build_object('key','sme','title','Review work','kind','stats','stats',coalesce((select jsonb_build_array(jsonb_build_object('label','Assigned','value',p.assigned_count),jsonb_build_object('label','In progress','value',p.pending_count),
     jsonb_build_object('label','Completed','value',p.reviewed_count),jsonb_build_object('label','Revisions requested','value',p.revision_count),jsonb_build_object('label','QA reversals','value',p.qa_reversal_count),
     jsonb_build_object('label','Unresolved compensation','value',(select count(*) from quizbox_competition.review_events e where e.reviewer_id=me.id and e.policy_context_snapshot->>'compensation_status'='COMPENSATION_UNRESOLVED')))
     from public.sme_performance p where p.reviewer_id=me.id),'[]'),'actions',jsonb_build_array(jsonb_build_object('label','Open review queue','href','/review'))),
   jsonb_build_object('key','earnings','title','Earnings','kind','list','empty','No earnings recorded yet.','items',coalesce((select jsonb_agg(jsonb_build_object('title',e.currency_code||' '||e.total,'subtitle',e.status)) from (select currency_code,status,sum(final_amount) total from public.reviewer_earnings where reviewer_id=me.id group by 1,2) e),'[]')),
   jsonb_build_object('key','qa','title','QA feedback','kind','list','empty','No senior QA feedback yet.','items',coalesce((select jsonb_agg(jsonb_build_object('title','Senior QA: '||e.decision,'subtitle',left(coalesce(e.review_notes,''),120),'href','/review') order by e.created_at desc)
     from (select e.* from public.sme_review_events e join public.sme_review_assignments w on w.id=e.assignment_id and w.review_kind='senior'
       where exists(select 1 from public.sme_review_assignments pw where pw.reviewer_id=me.id and (pw.id=(select x.primary_assignment_id from quizbox_competition.candidates x where x.id=e.candidate_id) or pw.question_id=e.question_id) and pw.review_kind='primary')
       order by e.created_at desc limit 5) e),'[]')));
 end if;
 return jsonb_build_object('role',role,'market',mk.name,'locale',mk.locale,'currency',mk.default_currency_code,'sections',s);
end $$;

revoke all on function quizbox_ops.question_signals(integer),quizbox_ops.student_insights(uuid) from public,anon,authenticated;
revoke all on function public.qb_content_quality(text,jsonb),public.qb_report_question(uuid,text),public.qb_student_insights(),public.qb_teacher_insights(),public.qb_platform_insights(),public.qb_home() from public,anon;
grant execute on function public.qb_content_quality(text,jsonb),public.qb_report_question(uuid,text),public.qb_student_insights(),public.qb_teacher_insights(),public.qb_platform_insights(),public.qb_home() to authenticated;
commit;
