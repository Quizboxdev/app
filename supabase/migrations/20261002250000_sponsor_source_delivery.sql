-- Staged local extension only. National curriculum predicates remain delegated.
begin;
alter table quizbox_competition.candidates add column review_revision integer not null default 1;
alter table public.sme_review_assignments alter column question_id drop not null;
alter table public.sme_review_assignments add column candidate_id uuid references quizbox_competition.candidates(id);
alter table public.sme_review_assignments add constraint sme_work_origin check(question_id is not null or candidate_id is not null);
create unique index candidate_one_open_review on public.sme_review_assignments(candidate_id,review_kind) where candidate_id is not null and review_completed_at is null;
alter table public.sme_review_events alter column question_id drop not null;
alter table public.sme_review_events add column candidate_id uuid references quizbox_competition.candidates(id);
alter table public.sme_review_events add constraint sme_event_origin check(question_id is not null or candidate_id is not null);

alter table public.questions add column content_origin text not null default 'CURRICULUM' check(content_origin in ('CURRICULUM','SPONSOR_DOCUMENT','HYBRID'));
alter table public.questions add column origin_candidate_id uuid unique references quizbox_competition.candidates(id);
alter table public.questions add column origin_metadata jsonb not null default '{}';
alter table public.questions alter column grade drop not null;
alter table public.questions add constraint question_grade_semantics check(grade is not null or (origin_candidate_id is not null and content_origin in ('SPONSOR_DOCUMENT','HYBRID')));
alter table public.assessments add column competition_snapshot_id uuid references quizbox_competition.snapshots(id);
alter table public.assessments add column source_mode text;
alter table public.assessments alter column grade drop not null;
alter table public.assessments add constraint assessment_grade_semantics check(grade is not null or source_mode in ('SPONSOR_SOURCE','HYBRID'));

create table quizbox_competition.registrations (
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references quizbox_competition.drafts(competition_id),
 snapshot_id uuid not null references quizbox_competition.snapshots(id), participant_id uuid not null references public.profiles(id),
 market_id uuid references public.markets(id), institution_id uuid, eligible boolean not null,
 status text not null check(status in ('REGISTERED','INELIGIBLE')), eligibility_snapshot jsonb not null,
 registered_at timestamptz not null default now(), unique(competition_id,participant_id)
);
create table quizbox_competition.invitations (
 competition_id uuid not null references quizbox_competition.drafts(competition_id), participant_id uuid not null references public.profiles(id),
 invited_by uuid not null references public.profiles(id), invited_at timestamptz not null default now(), primary key(competition_id,participant_id)
);
create table quizbox_competition.official_results (
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references quizbox_competition.drafts(competition_id),
 snapshot_id uuid not null references quizbox_competition.snapshots(id), participant_id uuid not null references public.profiles(id),
 attempt_id uuid not null unique references public.attempts(id), result_id uuid not null unique references public.assessment_results(id),
 score numeric not null, possible_score numeric not null, percentage numeric not null,
 duration_seconds numeric not null check(duration_seconds>=0), submitted_at timestamptz not null, rank_eligible boolean not null
);
create table quizbox_competition.leaderboard (
 competition_id uuid not null references quizbox_competition.drafts(competition_id), participant_id uuid not null references public.profiles(id),
 result_id uuid not null references quizbox_competition.official_results(id), rank integer not null,
 primary key(competition_id,participant_id)
);
do $$ declare t text; begin foreach t in array array['registrations','invitations','official_results','leaderboard'] loop
 execute format('alter table quizbox_competition.%I enable row level security',t);
 execute format('revoke all on quizbox_competition.%I from public,anon,authenticated',t);
end loop; end $$;
create trigger immutable_official_result before update or delete on quizbox_competition.official_results for each row execute function quizbox_competition.reject_mutation();
create trigger immutable_registration before update or delete on quizbox_competition.registrations for each row execute function quizbox_competition.reject_mutation();

create function quizbox_competition.source_valid(p_candidate uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from quizbox_competition.candidates x join quizbox_competition.drafts d on d.competition_id=x.competition_id
 join quizbox_competition.generation_jobs j on j.id=x.job_id join public.source_documents s on s.id=x.source_document_id
 join quizbox_competition.chunks ch on ch.id=x.source_chunk_id and ch.document_id=s.id
 where x.id=p_candidate and j.status in ('COMPLETED','PARTIAL') and s.validation_status='approved' and s.rights_confirmed
 and d.configuration->>'sourceMode'=j.input_snapshot->>'sourceMode' and d.configuration->>'scope'=j.input_snapshot->>'scope'
 and (d.configuration->'sourceIds') @> (j.input_snapshot->'sourceIds') and (j.input_snapshot->'sourceIds') @> (d.configuration->'sourceIds')
 and (d.configuration->'marketIds') @> (j.input_snapshot->'marketIds') and (j.input_snapshot->'marketIds') @> (d.configuration->'marketIds')
 and d.configuration->'sourceIds' @> jsonb_build_array(s.id)
 and (s.source_kind<>'SPONSOR_SOURCE' or (s.sponsor_id=d.sponsor_id and exists(select 1 from quizbox_competition.documents doc where doc.id=s.id and doc.competition_id=d.competition_id and doc.active and doc.ingestion_status='READY_FOR_GENERATION')))
 and not exists(select 1 from jsonb_array_elements_text(d.configuration->'sourceIds') a left join public.source_documents src on src.id=a::uuid where src.id is null or src.validation_status<>'approved' or not src.rights_confirmed
  or (src.source_kind='SPONSOR_SOURCE' and src.sponsor_id is distinct from d.sponsor_id))
 and (d.configuration->>'sourceMode'<>'CURRICULUM_ALIGNED' or (x.curriculum_id is not null and exists(select 1 from public.curriculum_nodes n where n.id=(x.payload->>'curriculumNodeId')::uuid and n.curriculum_id=x.curriculum_id and n.is_active and n.subject_code=x.payload->>'subject'
  and quizbox_market.node_allowed(n.id,j.input_snapshot->'authorizedContext'))))
 and (nullif(x.payload->>'curriculumNodeId','') is null or exists(select 1 from public.curriculum_nodes n where n.id=(x.payload->>'curriculumNodeId')::uuid and n.curriculum_id=x.curriculum_id and n.is_active and quizbox_market.node_allowed(n.id,j.input_snapshot->'authorizedContext'))));
$$;
create function quizbox_competition.candidate_domain(p_domain uuid,p_candidate uuid,p_reviewer uuid,p_senior boolean,p_approve boolean) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.sme_domain_assignments dom join public.sme_profiles sp on sp.user_id=dom.reviewer_id
 join public.profiles p on p.id=sp.user_id join quizbox_competition.candidates x on x.id=p_candidate
 join quizbox_competition.drafts d on d.competition_id=x.competition_id join public.source_documents src on src.id=x.source_document_id
 where dom.id=p_domain and dom.reviewer_id=p_reviewer and dom.active and sp.active and sp.reviewer_status='verified' and lower(p.status::text)='active'
 and dom.can_review and (not p_approve or dom.can_approve) and (not p_senior or dom.can_senior_review)
 and dom.subject_code=x.payload->>'subject' and (dom.curriculum_id is null or dom.curriculum_id=x.curriculum_id)
 and (dom.education_level is null or dom.education_level=x.payload->>'educationLevel')
 and (cardinality(dom.grade_codes)=0 or x.payload->>'canonicalGradeCode'=any(dom.grade_codes))
 and (dom.market_id is null or dom.market_id=src.market_id)
 and (src.market_id is null or quizbox_market.market_allowed(src.market_id,p_reviewer))
 and not exists(select 1 from jsonb_array_elements_text(d.configuration->'marketIds') m where not quizbox_market.market_allowed(m::uuid,p_reviewer))
 and quizbox_competition.source_valid(x.id));
$$;
create function quizbox_competition.senior_required(p_competition uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((d.configuration->>'seniorReviewRequired')::boolean,false) or exists(select 1 from public.markets m where d.configuration->'marketIds' @> jsonb_build_array(m.id) and coalesce((m.configuration->>'require_senior_qa')::boolean,false)) from quizbox_competition.drafts d where d.competition_id=p_competition;
$$;
create function quizbox_competition.candidate_errors(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
begin
 if nullif(btrim(p->>'stem'),'') is null or nullif(btrim(p->>'explanation'),'') is null or nullif(btrim(p->>'subject'),'') is null or nullif(btrim(p->>'cognitiveLevel'),'') is null
 or coalesce(jsonb_typeof(p->'options'),'')<>'array' then return '["INVALID_CANDIDATE"]'; end if;
 if jsonb_array_length(p->'options') not in (2,4) or (select count(distinct lower(btrim(x))) from jsonb_array_elements_text(p->'options') x)<>jsonb_array_length(p->'options')
 or exists(select 1 from jsonb_array_elements_text(p->'options') x where nullif(btrim(x),'') is null)
 or coalesce((p->>'correctAnswer')::integer,-1) not between 0 and jsonb_array_length(p->'options')-1
 or coalesce(p->>'difficulty','') not in ('easy','medium','hard')
 or p->>'stem' ~* '<[^>]*>|javascript:|data:|correct answer|answer key'
 or (jsonb_array_length(p->'options')=2 and (lower(p#>>'{options,0}')<>'true' or lower(p#>>'{options,1}')<>'false')) then return '["INVALID_CANDIDATE"]'; end if;
 return '[]';
exception when others then return '["INVALID_CANDIDATE"]'; end $$;

-- Copy original predicates under private names; keep original OIDs for policies.
do $$ begin
 execute replace(pg_get_functiondef('quizbox_market.question_allowed(uuid,jsonb)'::regprocedure),'FUNCTION quizbox_market.question_allowed','FUNCTION quizbox_competition.curriculum_question_allowed');
 execute replace(pg_get_functiondef('quizbox_market.question_guard()'::regprocedure),'FUNCTION quizbox_market.question_guard','FUNCTION quizbox_competition.curriculum_question_guard');
 execute replace(pg_get_functiondef('public.qb_content_validation_errors(jsonb)'::regprocedure),'FUNCTION public.qb_content_validation_errors','FUNCTION quizbox_competition.curriculum_validation_errors');
 execute replace(pg_get_functiondef('quizbox_market.assessment_allowed(uuid)'::regprocedure),'FUNCTION quizbox_market.assessment_allowed','FUNCTION quizbox_competition.curriculum_assessment_allowed');
end $$;

create function quizbox_competition.capture_attempt() returns trigger language plpgsql security definer set search_path='' as $$
declare sid uuid; snap quizbox_competition.snapshots; reg quizbox_competition.registrations; cfg jsonb; n integer;
begin
 select competition_snapshot_id into sid from public.assessments where id=new.assessment_id;
 if sid is null then return new; end if;
 select * into snap from quizbox_competition.snapshots where id=sid;
 select * into reg from quizbox_competition.registrations where competition_id=snap.competition_id and participant_id=new.student_user_id for update;
 cfg:=snap.payload->'configuration';
 if auth.uid() is distinct from new.student_user_id or reg.id is null or not reg.eligible or reg.status<>'REGISTERED' or reg.snapshot_id<>sid then raise exception 'COMPETITION_REGISTRATION_REQUIRED' using errcode='42501'; end if;
 if not exists(select 1 from public.competitions where id=snap.competition_id and status='PUBLISHED') or now()<(cfg->>'startsAt')::timestamptz or now()>=(cfg->>'endsAt')::timestamptz then raise exception 'COMPETITION_NOT_OPEN'; end if;
 select count(*)+1 into n from quizbox_competition.participations where competition_id=snap.competition_id and participant_id=new.student_user_id;
 if n>(cfg->>'attemptLimit')::integer then raise exception 'COMPETITION_ATTEMPT_LIMIT'; end if;
 update public.attempts set expires_at=least(started_at+make_interval(secs=>(cfg->>'durationSeconds')::integer),(cfg->>'endsAt')::timestamptz),deadline_at=least(started_at+make_interval(secs=>(cfg->>'durationSeconds')::integer),(cfg->>'endsAt')::timestamptz) where id=new.id;
 insert into quizbox_competition.participations(competition_id,snapshot_id,participant_id,attempt_id,attempt_number,eligibility_snapshot)
 values(snap.competition_id,sid,new.student_user_id,new.id,n,reg.eligibility_snapshot);
 return new;
end $$;
create trigger competition_attempt_capture after insert on public.attempts for each row execute function quizbox_competition.capture_attempt();

create function quizbox_competition.capture_result() returns trigger language plpgsql security definer set search_path='' as $$
declare p quizbox_competition.participations; a public.attempts; cfg jsonb;
begin
 select * into p from quizbox_competition.participations where attempt_id=new.attempt_id;
 if p.id is null then return new; end if;
 select * into a from public.attempts where id=new.attempt_id;
 select payload->'configuration' into cfg from quizbox_competition.snapshots where id=p.snapshot_id;
 perform 1 from public.competitions where id=p.competition_id for update;
 insert into quizbox_competition.official_results(competition_id,snapshot_id,participant_id,attempt_id,result_id,score,possible_score,percentage,duration_seconds,submitted_at,rank_eligible)
 values(p.competition_id,p.snapshot_id,p.participant_id,new.attempt_id,new.id,new.score,new.total_marks,new.percentage,greatest(0,extract(epoch from new.submitted_at-new.started_at)),new.submitted_at,new.submitted_at<=a.expires_at) on conflict(attempt_id) do nothing;
 delete from quizbox_competition.leaderboard where competition_id=p.competition_id;
 insert into quizbox_competition.leaderboard(competition_id,participant_id,result_id,rank)
 select p.competition_id,participant_id,id,rank() over(order by score desc,case when cfg->>'tieBreak'='completion_time' then duration_seconds else 0 end)::integer from
 (select distinct on(participant_id) * from quizbox_competition.official_results where competition_id=p.competition_id and rank_eligible order by participant_id,score desc,case when cfg->>'tieBreak'='completion_time' then duration_seconds else 0 end,submitted_at,id) best;
 return new;
end $$;
create trigger competition_official_result after insert on public.assessment_results for each row execute function quizbox_competition.capture_result();
create function quizbox_competition.protect_delivery() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from quizbox_competition.snapshots where assessment_id=case when tg_op='DELETE' then old.assessment_id else new.assessment_id end)
 or (tg_op='UPDATE' and exists(select 1 from quizbox_competition.snapshots where assessment_id=old.assessment_id)) then raise exception 'IMMUTABLE_COMPETITION_RECORD'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger immutable_competition_delivery before insert or update or delete on public.assessment_questions for each row execute function quizbox_competition.protect_delivery();

alter function quizbox_competition.dispatch(text,uuid,jsonb) rename to dispatch_review_bridge;
create function quizbox_competition.dispatch(p_action text,p_sponsor uuid,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare x quizbox_competition.candidates; d quizbox_competition.drafts; w public.sme_review_assignments; e public.sme_review_events;
 c uuid; cfg jsonb; result jsonb; state text; kind text; reviewer uuid; policy uuid; src public.source_documents;
 qid uuid; vid uuid; aid uuid; sid uuid; payload jsonb; ctx uuid; n public.curriculum_nodes; grade public.qb_grade; tier text;
 snap quizbox_competition.snapshots; reg quizbox_competition.registrations; participant public.profiles; learner public.student_profiles;
 market uuid; registration_eligible boolean; reasons jsonb; score_result jsonb; r public.assessment_results;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and lower(status::text)='active') then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>1500000 then raise exception 'INVALID_SPONSOR_INPUT'; end if;
 if p_action='review_queue' then
  return coalesce((select jsonb_agg(jsonb_build_object('candidate_id',a.id,'competition_id',a.competition_id,'assignment_id',work.id,'status',a.status,'review_kind',work.review_kind))
   from quizbox_competition.candidates a join public.sme_review_assignments work on work.candidate_id=a.id where work.reviewer_id=auth.uid() and work.review_completed_at is null
   and quizbox_competition.candidate_domain(work.domain_assignment_id,a.id,auth.uid(),work.review_kind='senior',false)),'[]');
 end if;
 if p_action in ('review_detail','complete_review') then
  select * into x from quizbox_competition.candidates where id=(p_data->>'candidate_id')::uuid for update;
  select * into w from public.sme_review_assignments where id=(p_data->>'assignment_id')::uuid and candidate_id=x.id and reviewer_id=auth.uid() for update;
  if w.id is null then return quizbox_competition.dispatch_review_bridge(p_action,p_sponsor,p_data); end if;
  if not quizbox_competition.candidate_domain(w.domain_assignment_id,x.id,auth.uid(),w.review_kind='senior',p_action='complete_review' and p_data->>'decision'='approve') then raise exception 'QB_REVIEW_DOMAIN_DENIED' using errcode='42501'; end if;
  if p_action='review_detail' then
   if w.review_started_at is null then update public.sme_review_assignments set review_started_at=now() where id=w.id returning * into w; end if;
   return jsonb_build_object('candidate_id',x.id,'assignment',to_jsonb(w),'question',x.payload||jsonb_build_object('id',x.id,'question_text',x.payload->>'stem','option_a',x.payload#>>'{options,0}','option_b',x.payload#>>'{options,1}','option_c',x.payload#>>'{options,2}','option_d',x.payload#>>'{options,3}','correct_answer',substr('ABCD',(x.payload->>'correctAnswer')::integer+1,1),'version',x.review_revision),'validation_errors',quizbox_competition.candidate_errors(x.payload));
  end if;
  if w.review_completed_at is not null then
   select * into e from public.sme_review_events where assignment_id=w.id;
   if e.decision is distinct from p_data->>'decision' then raise exception 'REVIEW_REPLAY_MISMATCH'; end if; return to_jsonb(e);
  end if;
  if p_data->>'decision' not in ('approve','revision','reject') or (p_data->>'human_reviewed')::boolean is distinct from true or length(btrim(coalesce(p_data->>'note',''))) not between 3 and 1000 or w.review_started_at is null
  or w.question_version<>x.review_revision or (p_data->>'version')::integer is distinct from x.review_revision then raise exception 'QB_HUMAN_REVIEW_REQUIRED'; end if;
  if p_data->>'decision'='approve' and quizbox_competition.candidate_errors(x.payload)<>'[]'::jsonb then raise exception 'QB_CONTENT_VALIDATION_FAILED'; end if;
  state:=case p_data->>'decision' when 'revision' then 'REVISION_REQUIRED' when 'reject' then 'REJECTED' else case when w.review_kind='primary' and quizbox_competition.senior_required(x.competition_id) then 'ASSIGNED_FOR_REVIEW' else 'APPROVED' end end;
  insert into public.sme_review_events(assignment_id,candidate_id,reviewer_id,assigned_at,review_started_at,review_completed_at,decision,review_notes,review_duration_seconds,revision_count,senior_reviewer_id,final_status,qa_reversal)
  values(w.id,x.id,auth.uid(),w.assigned_at,w.review_started_at,now(),p_data->>'decision',p_data->>'note',greatest(0,extract(epoch from now()-w.review_started_at)::integer),x.review_revision-1,case when w.review_kind='senior' then auth.uid() end,lower(state),false) returning * into e;
  update public.sme_review_assignments set review_completed_at=now() where id=w.id;
  insert into quizbox_competition.review_events(candidate_id,reviewer_id,assignment_id,decision,previous_state,new_state,notes,started_at,completed_at,policy_context_snapshot)
  values(x.id,auth.uid(),w.id,case e.decision when 'approve' then 'APPROVE' when 'reject' then 'REJECT' else 'REQUEST_REVISION' end,x.status,state,e.review_notes,e.review_started_at,e.review_completed_at,
   jsonb_build_object('policy_version_id',w.compensation_policy_version_id,'compensation_status',case when w.compensation_policy_version_id is null then 'COMPENSATION_UNRESOLVED' else 'POLICY_RESOLVED' end));
  update quizbox_competition.candidates set status=state,updated_at=now() where id=x.id;
  perform quizbox_competition.earn_review(w,e); return to_jsonb(e);
 end if;
 c:=(p_data->>'competition_id')::uuid;
 if p_action='discover' then
  return coalesce((select jsonb_agg(jsonb_build_object('competition_id',co.id,'title',co.title,'starts_at',s.payload#>>'{configuration,startsAt}','ends_at',s.payload#>>'{configuration,endsAt}','scope',s.payload#>>'{configuration,scope}'))
   from public.competitions co join quizbox_competition.snapshots s on s.competition_id=co.id where co.status='PUBLISHED'
   and (s.payload#>>'{configuration,scope}'='GLOBAL' or exists(select 1 from jsonb_array_elements_text(s.payload#>'{configuration,marketIds}') m where quizbox_market.market_allowed(m::uuid)))),'[]');
 end if;
 if p_action in ('register','start_competition','official_result','leaderboard','competition_info') then
  select * into snap from quizbox_competition.snapshots where competition_id=c order by version desc limit 1;
  if snap.id is null or not exists(select 1 from public.competitions where id=c and status='PUBLISHED') then raise exception 'COMPETITION_NOT_PUBLISHED'; end if; cfg:=snap.payload->'configuration';
  if cfg->>'scope'<>'GLOBAL' and not exists(select 1 from jsonb_array_elements_text(cfg->'marketIds') m where quizbox_market.market_allowed(m::uuid)) then raise exception 'MARKET_ACCESS_DENIED' using errcode='42501'; end if;
  if p_action='competition_info' then return jsonb_build_object('competition_id',c,'title',cfg->>'title','description',cfg->>'description','starts_at',cfg->>'startsAt','ends_at',cfg->>'endsAt','registration', (select to_jsonb(z) from quizbox_competition.registrations z where z.competition_id=c and z.participant_id=auth.uid()),'questions',cfg->'questionsPerAttempt','duration_seconds',cfg->'durationSeconds'); end if;
  if p_action='leaderboard' then
   if cfg->>'leaderboard'='hidden' or (cfg->>'leaderboard'='after_close' and now()<(cfg->>'endsAt')::timestamptz) then return '[]'; end if;
   if cfg->>'scope'<>'GLOBAL' and not exists(select 1 from jsonb_array_elements_text(cfg->'marketIds') m where quizbox_market.market_allowed(m::uuid)) then raise exception 'MARKET_ACCESS_DENIED' using errcode='42501'; end if;
   return coalesce((select jsonb_agg(to_jsonb(rows) order by rank,participant_id) from (select b.participant_id,b.rank,o.score,o.duration_seconds from quizbox_competition.leaderboard b join quizbox_competition.official_results o on o.id=b.result_id where b.competition_id=c order by b.rank,b.participant_id limit coalesce(nullif(cfg->>'topN','')::integer,1000)) rows),'[]');
  end if;
  select * into participant from public.profiles where id=auth.uid(); select * into learner from public.student_profiles where user_id=auth.uid() and status='active';
  if p_action='register' then
   select * into reg from quizbox_competition.registrations where competition_id=c and participant_id=auth.uid(); if reg.id is not null then return to_jsonb(reg); end if;
   market:=coalesce(nullif(p_data->>'market_id','')::uuid,participant.default_market_id); reasons:='[]';
   if learner.id is null then reasons:=reasons||'"LEARNER_PROFILE_REQUIRED"'::jsonb; end if;
   if now()<(cfg->>'registrationOpensAt')::timestamptz or now()>(cfg->>'registrationClosesAt')::timestamptz then reasons:=reasons||'"REGISTRATION_CLOSED"'::jsonb; end if;
   if cfg->>'scope'<>'GLOBAL' and (market is null or not coalesce(cfg->'marketIds' @> jsonb_build_array(market),false) or not quizbox_market.market_allowed(market)) then reasons:=reasons||'"MARKET_NOT_ELIGIBLE"'::jsonb; end if;
   if market is not null and not quizbox_market.market_allowed(market) then reasons:=reasons||'"MARKET_NOT_ELIGIBLE"'::jsonb; end if;
   if cfg->>'audience'<>'public' and upper(cfg->>'audience')<>upper(participant.role::text) then reasons:=reasons||'"AUDIENCE_NOT_ELIGIBLE"'::jsonb; end if;
   if coalesce(cfg->>'grades','')<>'' and not exists(select 1 from unnest(string_to_array(cfg->>'grades',',')) g where case btrim(g) when 'B10' then 'SHS1' else btrim(g) end=case learner.grade::text when 'B10' then 'SHS1' else learner.grade::text end) then reasons:=reasons||'"GRADE_NOT_ELIGIBLE"'::jsonb; end if;
   if coalesce(cfg->>'institutions','')<>'' and not exists(select 1 from unnest(string_to_array(cfg->>'institutions',',')) i where btrim(i)=learner.institution_id::text) then reasons:=reasons||'"INSTITUTION_NOT_ELIGIBLE"'::jsonb; end if;
   if cfg->>'access'<>'public' and not exists(select 1 from quizbox_competition.invitations where competition_id=c and participant_id=auth.uid()) then reasons:=reasons||'"INVITATION_REQUIRED"'::jsonb; end if;
   registration_eligible:=reasons='[]'::jsonb;
   insert into quizbox_competition.registrations(competition_id,snapshot_id,participant_id,market_id,institution_id,eligible,status,eligibility_snapshot)
   values(c,snap.id,auth.uid(),market,learner.institution_id,registration_eligible,case when registration_eligible then 'REGISTERED' else 'INELIGIBLE' end,jsonb_build_object('blockers',reasons,'scope',cfg->>'scope','source_mode',cfg->>'sourceMode','market_id',market,'audience',cfg->>'audience')) on conflict(competition_id,participant_id) do nothing;
   return (select to_jsonb(z) from quizbox_competition.registrations z where competition_id=c and participant_id=auth.uid());
  end if;
  select * into reg from quizbox_competition.registrations where competition_id=c and participant_id=auth.uid() for update;
  if reg.id is null or not reg.eligible then raise exception 'COMPETITION_REGISTRATION_REQUIRED' using errcode='42501'; end if;
  if reg.market_id is not null and not quizbox_market.market_allowed(reg.market_id) then raise exception 'MARKET_ACCESS_DENIED' using errcode='42501'; end if;
  if p_action='official_result' then return coalesce((select jsonb_agg(to_jsonb(o)) from quizbox_competition.official_results o where competition_id=c and participant_id=auth.uid()),'[]'); end if;
  if now()<(cfg->>'startsAt')::timestamptz or now()>=(cfg->>'endsAt')::timestamptz then raise exception 'COMPETITION_NOT_OPEN'; end if;
  result:=public.qb_start_attempt(snap.assessment_id,null,null,gen_random_uuid()::text);
  if result->>'status' is distinct from 'PASS' then raise exception '%',coalesce(result->>'message','ATTEMPT_START_FAILED'); end if; return result||jsonb_build_object('snapshot_id',snap.id,'competition_id',c);
 end if;
 if p_action='complete_competition' then
  if not exists(select 1 from quizbox_competition.participations where attempt_id=(p_data->>'attempt_id')::uuid and participant_id=auth.uid()) then raise exception 'COMPETITION_ATTEMPT_DENIED' using errcode='42501'; end if;
  result:=public.qb_complete_attempt((p_data->>'attempt_id')::uuid,'competition_submit');
  if result->>'attempt_id' is distinct from p_data->>'attempt_id' or result->>'status' not in ('submitted','expired') then raise exception '%',coalesce(result->>'message','ATTEMPT_SUBMIT_FAILED'); end if;
  return (select to_jsonb(o) from quizbox_competition.official_results o where attempt_id=(p_data->>'attempt_id')::uuid and participant_id=auth.uid());
 end if;
 if p_action='oversight' then
  if not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode='42501'; end if;
  return jsonb_build_object('sponsors',coalesce((select jsonb_agg(to_jsonb(s)) from public.sponsor_profiles s),'[]'),
   'competitions',coalesce((select jsonb_agg(jsonb_build_object('competition_id',a.competition_id,'sponsor_id',a.sponsor_id,'configuration',a.configuration,'blockers',quizbox_competition.publication_blockers(a.competition_id))) from quizbox_competition.drafts a),'[]'),
   'sources',coalesce((select jsonb_agg(to_jsonb(z)-'extraction_token') from quizbox_competition.documents z),'[]'),
   'jobs',coalesce((select jsonb_agg(to_jsonb(z)-'execution_token') from quizbox_competition.generation_jobs z),'[]'),
   'candidates',coalesce((select jsonb_agg(to_jsonb(z)) from quizbox_competition.candidates z),'[]'),
   'reviews',coalesce((select jsonb_agg(to_jsonb(z)) from quizbox_competition.review_events z),'[]'),
   'snapshots',coalesce((select jsonb_agg(to_jsonb(z)-'payload') from quizbox_competition.snapshots z),'[]'),
   'registrations',coalesce((select jsonb_agg(to_jsonb(z)) from quizbox_competition.registrations z),'[]'),
   'results',coalesce((select jsonb_agg(to_jsonb(z)) from quizbox_competition.official_results z),'[]'),
   'leaderboard',coalesce((select jsonb_agg(to_jsonb(z)) from quizbox_competition.leaderboard z),'[]'));
 end if;
 if p_action not in ('assign_candidate','revise_candidate','materialize_candidate','include_bank','publication_check','create_snapshot','publish','invite','analytics') then return quizbox_competition.dispatch_review_bridge(p_action,p_sponsor,p_data); end if;
 perform quizbox_competition.require_member(p_sponsor,p_action not in ('analytics','publication_check'));
 select * into d from quizbox_competition.drafts where competition_id=c and sponsor_id=p_sponsor for update;
 if d.competition_id is null then raise exception 'COMPETITION_ACCESS_DENIED' using errcode='42501'; end if; cfg:=d.configuration;
 if p_action='analytics' then
  return jsonb_build_object('registrations',(select count(*) from quizbox_competition.registrations where competition_id=c and eligible),
   'attempts_started',(select count(*) from quizbox_competition.participations where competition_id=c),
   'attempts_completed',(select count(*) from quizbox_competition.official_results where competition_id=c),
   'completion_rate',coalesce((select count(*)::numeric from quizbox_competition.official_results where competition_id=c)*100/nullif((select count(*) from quizbox_competition.participations where competition_id=c),0),0),
   'average_score',(select avg(score) from quizbox_competition.official_results where competition_id=c),
   'score_distribution',coalesce((select jsonb_agg(to_jsonb(z)) from (select floor(percentage/10)*10 bucket,count(*) n from quizbox_competition.official_results where competition_id=c group by 1) z),'[]'),
   'market_distribution',coalesce((select jsonb_agg(to_jsonb(z)) from (select market_id,count(*) n from quizbox_competition.registrations where competition_id=c and eligible group by market_id) z),'[]'),
   'institution_distribution',coalesce((select jsonb_agg(to_jsonb(z)) from (select institution_id,count(*) n from quizbox_competition.registrations where competition_id=c and eligible group by institution_id) z),'[]'),
   'question_performance',coalesce((select jsonb_agg(to_jsonb(z)) from (select resp.question_id,q.difficulty_label,count(*) responses,avg(case when resp.is_correct then 100 else 0 end) accuracy from public.responses resp join quizbox_competition.official_results o on o.attempt_id=resp.attempt_id join public.questions q on q.id=resp.question_id where o.competition_id=c group by resp.question_id,q.difficulty_label) z),'[]'),
   'ranking_summary',coalesce((select jsonb_agg(to_jsonb(z)) from quizbox_competition.leaderboard z where competition_id=c),'[]'));
 end if;
 if p_action='publication_check' then return jsonb_build_object('blockers',quizbox_competition.publication_blockers(c)); end if;
 if p_action='publish' then
  reasons:=quizbox_competition.publication_blockers(c); if reasons<>'[]'::jsonb then return jsonb_build_object('published',false,'blockers',reasons); end if;
  update public.competitions set status='PUBLISHED',updated_at=now() where id=c;
  return jsonb_build_object('published',true,'blockers','[]'::jsonb);
 end if;
 if p_action='invite' then
  insert into quizbox_competition.invitations(competition_id,participant_id,invited_by) values(c,(p_data->>'participant_id')::uuid,auth.uid()) on conflict do nothing; return jsonb_build_object('saved',true);
 end if;
 if p_action='create_snapshot' then
  select * into snap from quizbox_competition.snapshots where competition_id=c;
  if snap.id is not null then return jsonb_build_object('snapshot_id',snap.id,'assessment_id',snap.assessment_id); end if;
  reasons:=quizbox_competition.publication_blockers(c,false); if reasons<>'[]'::jsonb then return jsonb_build_object('blockers',reasons); end if;
  ctx:=public.qb_create_content_context(cfg->>'scope',cfg->>'sourceMode',array(select v::uuid from jsonb_array_elements_text(cfg->'marketIds') v),array(select v::uuid from jsonb_array_elements_text(cfg->'sourceIds') v));
  select jsonb_agg(jsonb_build_object('version_id',v.id,'question_id',v.question_id,'content',v.snapshot) order by b.position) into payload from quizbox_competition.bank_items b join public.question_versions v on v.id=b.question_version_id where b.competition_id=c and b.included;
  if cfg->>'sourceMode'='CURRICULUM_ALIGNED' then select q.grade into grade from quizbox_competition.bank_items b join public.question_versions v on v.id=b.question_version_id join public.questions q on q.id=v.question_id where b.competition_id=c and b.included limit 1; end if;
  insert into public.assessments(assessment_type,owner_role,owner_user_id,subject_code,subject_name,grade,question_count,time_limit_minutes,max_attempts,pass_percent,opens_at,expires_at,tenant_id,reference_type,reference_id,source_mode)
  values('COMPETITION','sponsor',auth.uid(),'COMPETITION',cfg->>'title',grade,(cfg->>'totalQuestions')::integer,ceil((cfg->>'durationSeconds')::numeric/60),(cfg->>'attemptLimit')::integer,coalesce(nullif(cfg->>'passMark','')::numeric,50),(cfg->>'startsAt')::timestamptz,(cfg->>'endsAt')::timestamptz,public.qb_public_tenant_id(),'COMPETITION',c,cfg->>'sourceMode') returning id into aid;
  update public.competitions set assessment_id=aid,content_context_id=ctx where id=c;
  update quizbox_competition.drafts set content_context_id=ctx where competition_id=c;
  insert into public.assessment_questions(assessment_id,question_id,question_order,question_text_snapshot,option_a_snapshot,option_b_snapshot,option_c_snapshot,option_d_snapshot,correct_answer_snapshot,marks_snapshot,answer_type_snapshot,answer_spec_snapshot,question_content_snapshot,source_type_snapshot,question_version_snapshot,editorial_approved_snapshot)
  select aid,(v->>'question_id')::uuid,row_number() over(),v#>>'{content,question_text}',v#>>'{content,option_a}',v#>>'{content,option_b}',v#>>'{content,option_c}',v#>>'{content,option_d}',v#>>'{content,correct_answer}',(v#>>'{content,marks}')::numeric,v#>>'{content,answer_type}',v#>'{content,answer_spec}',v#>'{content,question_content}',v#>>'{content,source_type}',(v#>>'{content,version}')::integer,true from jsonb_array_elements(payload) v;
  payload:=jsonb_build_object('competition_id',c,'version',1,'configuration',cfg,'questions',payload,'source_context',(select to_jsonb(z) from public.content_contexts z where id=ctx),'created_at',now(),'created_by',auth.uid());
  insert into quizbox_competition.snapshots(competition_id,version,payload,checksum,published_by,assessment_id) values(c,1,payload,encode(extensions.digest(payload::text,'sha256'),'hex'),auth.uid(),aid) returning id into sid;
  update public.assessments set competition_snapshot_id=sid where id=aid;
  return jsonb_build_object('snapshot_id',sid,'assessment_id',aid,'blockers','[]'::jsonb);
 end if;
 select * into x from quizbox_competition.candidates where id=(p_data->>'candidate_id')::uuid and competition_id=c for update;
 if x.id is null then raise exception 'CANDIDATE_ACCESS_DENIED' using errcode='42501'; end if;
 if p_action='materialize_candidate' then
  if x.question_id is not null then return jsonb_build_object('question_id',x.question_id,'version_id',x.approved_version_id,'idempotent',true); end if;
  if x.status<>'APPROVED' or not quizbox_competition.source_valid(x.id) then raise exception 'CANDIDATE_NOT_APPROVED'; end if;
  select * into e from public.sme_review_events where assignment_id=case when quizbox_competition.senior_required(c) then x.senior_assignment_id else x.primary_assignment_id end and decision='approve';
  if e.id is null then raise exception 'REVIEW_INCOMPLETE'; end if;
  select * into n from public.curriculum_nodes where id=nullif(x.payload->>'curriculumNodeId','')::uuid;
  insert into public.questions(external_question_id,question_code,subject_code,subject_name,grade,source_grade_code,canonical_grade_code,curriculum_id,curriculum_node_id,question_text,option_a,option_b,option_c,option_d,correct_answer,answer_type,answer_spec,explanation,difficulty_label,difficulty_code,cognitive_level,marks,estimated_time_seconds,source_type,status,validation_status,reviewed_by,reviewed_at,editorial_metadata,source_document_ids,content_origin,origin_candidate_id,origin_metadata)
  values('sponsor-candidate:'||x.id,'sponsor-candidate:'||x.id,x.payload->>'subject',x.payload->>'subject',coalesce(n.source_grade_code,n.grade_code)::public.qb_grade,n.source_grade_code,n.canonical_grade_code,x.curriculum_id,n.id,x.payload->>'stem',x.payload#>>'{options,0}',x.payload#>>'{options,1}',coalesce(x.payload#>>'{options,2}',''),coalesce(x.payload#>>'{options,3}',''),substr('ABCD',(x.payload->>'correctAnswer')::integer+1,1),case when jsonb_array_length(x.payload->'options')=2 then 'TRUE_FALSE' else 'SINGLE_CHOICE' end,
  case when jsonb_array_length(x.payload->'options')=2 then jsonb_build_object('boolean',(x.payload->>'correctAnswer')::integer=0) else '{}'::jsonb end,x.payload->>'explanation',x.payload->>'difficulty',x.payload->>'difficulty',x.payload->>'cognitiveLevel',1,60,'AI_GENERATED','active','approved',e.reviewer_id,e.review_completed_at,jsonb_build_object('human_reviewed',true,'review_event_id',e.id),
  array(select v::uuid from jsonb_array_elements_text(cfg->'sourceIds') v),case cfg->>'sourceMode' when 'SPONSOR_SOURCE' then 'SPONSOR_DOCUMENT' when 'HYBRID' then 'HYBRID' else 'CURRICULUM' end,x.id,
  jsonb_build_object('competition_id',c,'sponsor_id',p_sponsor,'market_scope',cfg->>'scope','market_ids',cfg->'marketIds','source_mode',cfg->>'sourceMode','source_document_id',x.source_document_id,'source_chunk_id',x.source_chunk_id,'generation_job_id',x.job_id,'candidate_id',x.id,'education_level',x.payload->>'educationLevel','created_by',auth.uid(),'approved_by',e.reviewer_id,'review_event_id',e.id)) returning id into qid;
  select id into vid from public.question_versions where question_id=qid and version_no=1;
  if vid is null then raise exception 'QUESTION_VERSION_CAPTURE_REQUIRED'; end if;
  update quizbox_competition.candidates set question_id=qid,approved_version_id=vid where id=x.id;
  return jsonb_build_object('question_id',qid,'version_id',vid);
 end if;
 if exists(select 1 from quizbox_competition.snapshots where competition_id=c) then raise exception 'COMPETITION_FROZEN'; end if;
 if p_action='include_bank' then
  if x.question_id is null then perform quizbox_competition.dispatch('materialize_candidate',p_sponsor,p_data); end if;
  return quizbox_competition.dispatch_review_bridge(p_action,p_sponsor,p_data);
 elsif p_action='assign_candidate' then
  kind:=coalesce(p_data->>'kind','primary'); reviewer:=(p_data->>'reviewer_id')::uuid;
  if kind not in ('primary','senior') or x.question_id is not null then raise exception 'INVALID_CANDIDATE_REVIEW'; end if;
  if not quizbox_competition.candidate_domain((p_data->>'domain_id')::uuid,x.id,reviewer,kind='senior',false) then raise exception 'QB_REVIEW_DOMAIN_DENIED' using errcode='42501'; end if;
  if kind='senior' and (not exists(select 1 from public.sme_review_events where assignment_id=x.primary_assignment_id and decision='approve') or exists(select 1 from public.sme_review_assignments where id=x.primary_assignment_id and reviewer_id=reviewer)) then raise exception 'INDEPENDENT_PRIMARY_REVIEW_REQUIRED'; end if;
  select * into w from public.sme_review_assignments where candidate_id=x.id and question_version=x.review_revision and review_kind=kind and reviewer_id=reviewer;
  if w.id is not null then return to_jsonb(w); end if;
  if x.status not in ('GENERATED','ASSIGNED_FOR_REVIEW') or (kind='primary' and x.primary_assignment_id is not null) or (kind='senior' and x.senior_assignment_id is not null) then raise exception 'CANDIDATE_ALREADY_REVIEWED'; end if;
  select reviewer_tier into tier from public.sme_profiles where user_id=reviewer; select * into src from public.source_documents where id=x.source_document_id;
  policy:=quizbox_sme.resolve_policy(src.market_id,null,p_sponsor,tier,x.payload->>'subject',x.payload->>'educationLevel',now());
  insert into public.sme_review_assignments(candidate_id,question_version,reviewer_id,domain_assignment_id,market_id,sponsor_id,compensation_policy_version_id,review_kind,assigned_by)
  values(x.id,x.review_revision,reviewer,(p_data->>'domain_id')::uuid,src.market_id,p_sponsor,policy,kind,auth.uid()) returning * into w;
  update quizbox_competition.candidates set status='ASSIGNED_FOR_REVIEW',primary_assignment_id=case when kind='primary' then w.id else primary_assignment_id end,senior_assignment_id=case when kind='senior' then w.id else senior_assignment_id end where id=x.id; return to_jsonb(w);
 elsif p_action='revise_candidate' then
  if x.status<>'REVISION_REQUIRED' or x.question_id is not null or exists(select 1 from public.sme_review_assignments where candidate_id=x.id and review_completed_at is null) then raise exception 'CANDIDATE_NOT_REVISION_READY'; end if;
  if exists(select 1 from jsonb_object_keys(p_data->'patch') k where k not in ('stem','options','correctAnswer','explanation','difficulty','cognitiveLevel')) or quizbox_competition.candidate_errors(x.payload||p_data->'patch')<>'[]'::jsonb then raise exception 'INVALID_CANDIDATE_REVISION'; end if;
  update quizbox_competition.candidates set payload=payload||p_data->'patch',review_revision=review_revision+1,status='GENERATED',primary_assignment_id=null,senior_assignment_id=null where id=x.id; return jsonb_build_object('saved',true);
 end if;
 raise exception 'INVALID_SPONSOR_ACTION';
end $$;
create or replace function public.qb_sponsor_workspace(p_action text,p_sponsor uuid default null,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select quizbox_competition.dispatch(p_action,p_sponsor,p_data); $$;
create function quizbox_competition.question_provenance(p jsonb) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from quizbox_competition.candidates x join quizbox_competition.drafts d on d.competition_id=x.competition_id
 join public.sme_review_events e on e.assignment_id=case when quizbox_competition.senior_required(x.competition_id) then x.senior_assignment_id else x.primary_assignment_id end
 where x.id=nullif(p->>'origin_candidate_id','')::uuid and x.status='APPROVED' and e.decision='approve'
 and e.reviewer_id=(p->>'reviewed_by')::uuid and quizbox_competition.source_valid(x.id)
 and p->>'question_text'=x.payload->>'stem' and p->>'explanation'=x.payload->>'explanation'
 and p->>'correct_answer'=substr('ABCD',(x.payload->>'correctAnswer')::integer+1,1)
 and p->>'option_a'=x.payload#>>'{options,0}' and p->>'option_b'=x.payload#>>'{options,1}'
 and coalesce(p->>'option_c','')=coalesce(x.payload#>>'{options,2}','') and coalesce(p->>'option_d','')=coalesce(x.payload#>>'{options,3}','')
 and p->>'subject_code'=x.payload->>'subject'
 and nullif(p->>'curriculum_id','')::uuid is not distinct from x.curriculum_id
 and nullif(p->>'curriculum_node_id','')::uuid is not distinct from nullif(x.payload->>'curriculumNodeId','')::uuid
 and (p->'source_document_ids') @> (d.configuration->'sourceIds') and (d.configuration->'sourceIds') @> (p->'source_document_ids')
 and p->>'content_origin'=case d.configuration->>'sourceMode' when 'SPONSOR_SOURCE' then 'SPONSOR_DOCUMENT' when 'HYBRID' then 'HYBRID' else 'CURRICULUM' end
 and p#>>'{origin_metadata,competition_id}'=x.competition_id::text and p#>>'{origin_metadata,sponsor_id}'=d.sponsor_id::text
 and p#>>'{origin_metadata,source_document_id}'=x.source_document_id::text and p#>>'{origin_metadata,source_chunk_id}'=x.source_chunk_id::text
 and p#>>'{origin_metadata,generation_job_id}'=x.job_id::text
 and p#>>'{origin_metadata,candidate_id}'=x.id::text and p#>>'{origin_metadata,source_mode}'=d.configuration->>'sourceMode'
 and p#>>'{origin_metadata,market_scope}'=d.configuration->>'scope'
 and (p#>'{origin_metadata,market_ids}')=(d.configuration->'marketIds')
 and p#>>'{origin_metadata,approved_by}'=e.reviewer_id::text and p#>>'{origin_metadata,review_event_id}'=e.id::text);
$$;
create or replace function public.qb_content_validation_errors(p jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare errors jsonb;
begin
 errors:=quizbox_competition.curriculum_validation_errors(p);
 if p->>'content_origin' in ('SPONSOR_DOCUMENT','HYBRID') and nullif(p->>'curriculum_node_id','') is null and quizbox_competition.question_provenance(p) then
  select coalesce(jsonb_agg(v),'[]') into errors from jsonb_array_elements(errors) v where v<>'"INVALID_INDICATOR"'::jsonb;
 end if;
 return errors;
end $$;
create or replace function quizbox_market.question_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare x quizbox_competition.candidates; sponsor uuid;
begin
 if auth.uid() is null and new.origin_candidate_id is null then return new; end if;
 if new.origin_candidate_id is null then
  -- Execute the preserved curriculum trigger with its original record semantics.
  if tg_op='UPDATE' then perform quizbox_market.assert_question(old.id);
   if new.curriculum_id is distinct from old.curriculum_id or new.curriculum_node_id is distinct from old.curriculum_node_id or new.source_document_ids is distinct from old.source_document_ids then raise exception 'QB_CONTENT_MAPPING_CHANGE_REQUIRES_REVIEW'; end if;
  else
   declare c jsonb; begin select content_context into c from public.content_import_batches where id=new.import_batch_id; if c is null then c:=quizbox_market.resolve_context(); end if;
   if not coalesce(quizbox_market.node_allowed(new.curriculum_node_id,c),false) then raise exception 'QB_CURRICULUM_OUTSIDE_CONTENT_CONTEXT' using errcode='42501'; end if;
   if coalesce(jsonb_array_length(c->'source_document_ids'),0)=0 then raise exception 'QB_EXPLICIT_APPROVED_SOURCES_REQUIRED'; end if;
   new.source_document_ids:=array(select v::uuid from jsonb_array_elements_text(c->'source_document_ids') v); end;
  end if; return new;
 end if;
 select * into x from quizbox_competition.candidates where id=new.origin_candidate_id;
 select sponsor_id into sponsor from quizbox_competition.drafts where competition_id=x.competition_id;
 if tg_op='UPDATE' then raise exception 'IMMUTABLE_SPONSOR_QUESTION'; end if;
 perform quizbox_competition.require_member(sponsor,true);
 if not quizbox_competition.question_provenance(to_jsonb(new)) then raise exception 'INVALID_QUESTION_PROVENANCE' using errcode='42501'; end if;
 if new.content_origin='CURRICULUM' or new.curriculum_node_id is not null then
  if not quizbox_market.node_allowed(new.curriculum_node_id,(select input_snapshot->'authorizedContext' from quizbox_competition.generation_jobs where id=x.job_id)) then raise exception 'QB_CURRICULUM_OUTSIDE_CONTENT_CONTEXT' using errcode='42501'; end if;
 end if;
 return new;
end $$;
create or replace function quizbox_market.question_allowed(p_question uuid,p_context jsonb default null) returns boolean language plpgsql stable security definer set search_path='' as $$
declare q public.questions; x quizbox_competition.candidates; sponsor uuid;
begin
 select * into q from public.questions where id=p_question;
 if q.origin_candidate_id is null then return quizbox_competition.curriculum_question_allowed(p_question,p_context); end if;
 select * into x from quizbox_competition.candidates where id=q.origin_candidate_id;
 select sponsor_id into sponsor from quizbox_competition.drafts where competition_id=x.competition_id;
 if not quizbox_competition.source_valid(x.id) or not exists(select 1 from public.profiles p where p.id=auth.uid() and lower(p.status::text)='active') then return false; end if;
 return quizbox_market.is_super()
 or exists(select 1 from quizbox_competition.organization_members om join quizbox_competition.sponsor_organizations so on so.sponsor_id=om.sponsor_id join public.sponsor_profiles sp on sp.id=om.sponsor_id where om.sponsor_id=sponsor and om.user_id=auth.uid() and om.active and lower(sp.status)='active' and quizbox_market.market_allowed(so.market_id))
 or exists(select 1 from public.sme_review_assignments w where w.candidate_id=x.id and w.reviewer_id=auth.uid() and quizbox_competition.candidate_domain(w.domain_assignment_id,x.id,auth.uid(),w.review_kind='senior',false))
 or exists(select 1 from quizbox_competition.registrations r join public.competitions c on c.id=r.competition_id where r.competition_id=x.competition_id and r.participant_id=auth.uid() and r.eligible and r.status='REGISTERED' and c.status='PUBLISHED');
end $$;

create function quizbox_competition.earn_review(w public.sme_review_assignments,e public.sme_review_events) returns void language plpgsql security definer set search_path='' as $$
declare v public.compensation_policy_versions; fee numeric; decimals integer; tax numeric;
begin
 if w.compensation_policy_version_id is null then return; end if;
 select * into v from public.compensation_policy_versions where id=w.compensation_policy_version_id;
 select decimal_places into decimals from public.currencies where code=v.currency_code;
 fee:=v.base_review_fee+case when w.review_kind='senior' then v.senior_review_fee when e.decision='approve' then v.approve_fee when e.decision='reject' then v.reject_fee else v.revision_fee end;
 tax:=coalesce((v.tax_or_withholding->>'percentage')::numeric,0);
 insert into public.reviewer_earnings(reviewer_id,review_event_id,compensation_policy_version_id,earning_type,quantity,base_amount,currency_code,multiplier,bonus_amount,deduction_amount,final_amount)
 values(e.reviewer_id,e.id,v.id,w.review_kind||'_'||e.decision,1,fee,v.currency_code,v.complexity_multiplier,v.quality_bonus_amount,
 round((fee*v.complexity_multiplier+v.quality_bonus_amount)*tax/100,decimals),round(fee*v.complexity_multiplier+v.quality_bonus_amount,decimals)-round((fee*v.complexity_multiplier+v.quality_bonus_amount)*tax/100,decimals)) on conflict(review_event_id) do nothing;
end $$;

create function quizbox_competition.publication_blockers(p_competition uuid,p_require_snapshot boolean default true) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d quizbox_competition.drafts; cfg jsonb; issues jsonb:='[]'; n integer; k text; target integer; actual integer; required_count integer; total integer;
begin
 select * into d from quizbox_competition.drafts where competition_id=p_competition; cfg:=d.configuration;
 if not exists(select 1 from public.sponsor_profiles where id=d.sponsor_id and lower(status)='active') then issues:=issues||'"SPONSOR_NOT_ACTIVE"'::jsonb; end if;
 begin
  perform quizbox_market.validate_context(cfg->>'scope',cfg->>'sourceMode',array(select v::uuid from jsonb_array_elements_text(cfg->'marketIds') v),array(select v::uuid from jsonb_array_elements_text(cfg->'sourceIds') v));
 exception when others then issues:=issues||'"UNRESOLVED_SOURCE_OR_MARKET_SCOPE"'::jsonb; end;
 begin
 if (cfg->>'registrationOpensAt')::timestamptz>(cfg->>'registrationClosesAt')::timestamptz or (cfg->>'registrationClosesAt')::timestamptz>(cfg->>'startsAt')::timestamptz or (cfg->>'startsAt')::timestamptz>=(cfg->>'endsAt')::timestamptz or (cfg->>'endsAt')::timestamptz<=now()
 or exists(select 1 from unnest(array['registrationOpensAt','registrationClosesAt','startsAt','endsAt']) v where nullif(cfg->>v,'') is null) then issues:=issues||'"INVALID_DATES"'::jsonb; end if;
 exception when others then issues:=issues||'"INVALID_DATES"'::jsonb; end;
 if coalesce(cfg->>'audience','') not in ('student','teacher','public','employee','custom') or coalesce(cfg->>'access','') not in ('public','private','invite_only') then issues:=issues||'"INVALID_AUDIENCE"'::jsonb; end if;
 -- The current engine has no verified age/employment claims or per-attempt bank
 -- subsets. Reject unsupported configurations instead of silently ignoring them.
 if coalesce(cfg->>'minAge','')<>'' or coalesce(cfg->>'maxAge','')<>'' or cfg->>'audience' in ('employee','custom') then issues:=issues||'"UNVERIFIED_AUDIENCE_ATTRIBUTES"'::jsonb; end if;
 if coalesce((cfg->>'questionsPerAttempt')::integer,0)<>coalesce((cfg->>'totalQuestions')::integer,0) or coalesce((cfg->>'randomizeAnswers')::boolean,false) or coalesce((cfg->>'randomizeQuestions')::boolean,false)
 or coalesce((cfg->>'negativeMarking')::numeric,0)<>0 then issues:=issues||'"UNSUPPORTED_ENGINE_CONFIGURATION"'::jsonb; end if;
 if coalesce((cfg->>'totalQuestions')::integer,0) not between 1 and 500 or coalesce((cfg->>'durationSeconds')::integer,0)<1 or coalesce((cfg->>'attemptLimit')::integer,0)<1 or cfg->>'scoring' is distinct from 'points'
 or coalesce((nullif(cfg->>'passMark',''))::numeric,50) not between 0 and 100 then issues:=issues||'"INVALID_ASSESSMENT_CONFIGURATION"'::jsonb; end if;
 if coalesce(cfg->>'tieBreak','') not in ('score_only','completion_time') or coalesce(cfg->>'leaderboard','') not in ('hidden','during','after_close')
 or coalesce(nullif(cfg->>'topN','')::integer,1000) not between 1 and 1000 then issues:=issues||'"INVALID_LEADERBOARD_CONFIGURATION"'::jsonb; end if;
 if coalesce(cfg->>'answerVisibility','') not in ('never','after_submission','after_close') or coalesce(cfg->>'explanationVisibility','') not in ('never','after_submission','after_close') then issues:=issues||'"INVALID_REVIEW_VISIBILITY"'::jsonb; end if;
 select count(*) into total from quizbox_competition.bank_items where competition_id=p_competition and included;
 if total<>coalesce((cfg->>'totalQuestions')::integer,0) then issues:=issues||'"NOT_ENOUGH_APPROVED_QUESTIONS"'::jsonb; end if;
 if exists(select 1 from quizbox_competition.bank_items b join quizbox_competition.candidates x on x.id=b.candidate_id join public.question_versions v on v.id=b.question_version_id
 where b.competition_id=p_competition and b.included and (x.status<>'APPROVED' or x.approved_version_id is distinct from v.id or not quizbox_competition.source_valid(x.id)
 or v.snapshot->>'validation_status' is distinct from 'approved')) then issues:=issues||'"INVALID_BANK_OR_SOURCE"'::jsonb; end if;
 if exists(select 1 from quizbox_competition.bank_items b join quizbox_competition.candidates x on x.id=b.candidate_id where b.competition_id=p_competition and b.included
 and (not exists(select 1 from public.sme_review_events where assignment_id=x.primary_assignment_id and decision='approve')
 or (quizbox_competition.senior_required(p_competition) and not exists(select 1 from public.sme_review_events where assignment_id=x.senior_assignment_id and decision='approve')))) then issues:=issues||'"REVIEW_INCOMPLETE"'::jsonb; end if;
 if coalesce((cfg->>'easy')::numeric,0)+coalesce((cfg->>'medium')::numeric,0)+coalesce((cfg->>'hard')::numeric,0)<>100 then issues:=issues||'"INVALID_DIFFICULTY_BALANCE"'::jsonb;
 else
  for k,required_count in with raw as (select key,((cfg->>'totalQuestions')::numeric*value::numeric/100) quota from jsonb_each_text(jsonb_build_object('easy',cfg->'easy','medium',cfg->'medium','hard',cfg->'hard'))), ranked as (select *,row_number() over(order by quota-floor(quota) desc,case key when 'easy' then 1 when 'medium' then 2 else 3 end) rn,sum(floor(quota)) over() base from raw)
   select key,(floor(quota)+case when rn<=(cfg->>'totalQuestions')::integer-base then 1 else 0 end)::integer from ranked loop
   select count(*) into actual from quizbox_competition.bank_items b join quizbox_competition.candidates x on x.id=b.candidate_id where b.competition_id=p_competition and b.included and x.payload->>'difficulty'=k;
   if actual<>required_count then issues:=issues||'"BANK_DIFFICULTY_MIX_MISMATCH"'::jsonb; exit; end if;
  end loop;
 end if;
 if cfg->'domainCounts' is not null then for k,target in select key,value::integer from jsonb_each_text(cfg->'domainCounts') loop
  select count(*) into actual from quizbox_competition.bank_items b join quizbox_competition.candidates x on x.id=b.candidate_id where b.competition_id=p_competition and b.included and x.payload->>'subject'=k;
  if actual<>target then issues:=issues||'"BANK_DOMAIN_MIX_MISMATCH"'::jsonb; exit; end if; end loop; end if;
 if p_require_snapshot and not exists(select 1 from quizbox_competition.snapshots where competition_id=p_competition) then issues:=issues||'"MISSING_SNAPSHOT"'::jsonb; end if;
 return (select coalesce(jsonb_agg(distinct v),'[]') from jsonb_array_elements(issues) v);
exception when others then return issues||'"MALFORMED_CONFIGURATION"'::jsonb;
end $$;

-- Raw answer-bearing rows stay unavailable to participant-only access, including
-- teachers participating outside their editorial authorization.
create function quizbox_competition.raw_question_allowed(p_question uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.questions q join quizbox_competition.candidates x on x.id=q.origin_candidate_id join quizbox_competition.drafts d on d.competition_id=x.competition_id where q.id=p_question
 and quizbox_market.question_allowed(q.id) and (quizbox_market.is_super()
 or exists(select 1 from quizbox_competition.organization_members om where om.sponsor_id=d.sponsor_id and om.user_id=auth.uid() and om.active)
 or exists(select 1 from public.sme_review_assignments w where w.candidate_id=x.id and w.reviewer_id=auth.uid() and quizbox_competition.candidate_domain(w.domain_assignment_id,x.id,auth.uid(),w.review_kind='senior',false))));
$$;
create policy sponsor_answer_isolation on public.questions as restrictive for select to authenticated using(origin_candidate_id is null or quizbox_competition.raw_question_allowed(id));
grant execute on function quizbox_competition.raw_question_allowed(uuid) to authenticated;

create function quizbox_competition.protect_assessment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.competition_snapshot_id is not null then raise exception 'IMMUTABLE_COMPETITION_RECORD'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger immutable_competition_assessment before update or delete on public.assessments for each row execute function quizbox_competition.protect_assessment();

do $$ begin
 execute replace(pg_get_functiondef('public.qb_get_attempt_review(uuid)'::regprocedure),'FUNCTION public.qb_get_attempt_review','FUNCTION quizbox_competition.engine_attempt_review');
end $$;
create or replace function public.qb_get_attempt_review(p_attempt_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; snap quizbox_competition.snapshots; cfg jsonb; show_answers boolean; show_explanations boolean;
begin
 result:=quizbox_competition.engine_attempt_review(p_attempt_id);
 select s.* into snap from quizbox_competition.snapshots s join quizbox_competition.participations p on p.snapshot_id=s.id where p.attempt_id=p_attempt_id;
 if snap.id is null then return result; end if; cfg:=snap.payload->'configuration';
 show_answers:=cfg->>'answerVisibility'='after_submission' or (cfg->>'answerVisibility'='after_close' and now()>=(cfg->>'endsAt')::timestamptz);
 show_explanations:=cfg->>'explanationVisibility'='after_submission' or (cfg->>'explanationVisibility'='after_close' and now()>=(cfg->>'endsAt')::timestamptz);
 return jsonb_set(result,'{questions}',coalesce((select jsonb_agg((case when show_answers then q else q-'correct_answer'-'answer_spec' end)||case when show_explanations then jsonb_build_object('explanation',(select v#>>'{content,explanation}' from jsonb_array_elements(snap.payload->'questions') v where v->>'question_id'=q->>'question_id')) else '{}'::jsonb end order by (q->>'question_order')::integer) from jsonb_array_elements(result->'questions') q),'[]'::jsonb));
end $$;

create or replace function quizbox_market.assessment_allowed(p_assessment uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare c jsonb;
begin
 if not exists(select 1 from public.assessments a join quizbox_competition.snapshots s on s.id=a.competition_snapshot_id where a.id=p_assessment and a.source_mode in ('SPONSOR_SOURCE','HYBRID')) then return quizbox_competition.curriculum_assessment_allowed(p_assessment); end if;
 c:=quizbox_market.assessment_context(p_assessment);
 return exists(select 1 from public.assessment_questions where assessment_id=p_assessment)
 and not exists(select 1 from public.assessment_questions aq join public.questions q on q.id=aq.question_id where aq.assessment_id=p_assessment and
 (not quizbox_market.question_allowed(q.id,c) or (q.curriculum_node_id is not null and not quizbox_market.node_allowed(q.curriculum_node_id,c))));
exception when sqlstate '42501' then return false;
end $$;

create or replace function quizbox_market.competition_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.content_contexts;
begin
 if auth.uid() is null then return new; end if;
 if tg_op='UPDATE' and old.content_context_id is not null and new.content_context_id is distinct from old.content_context_id then raise exception 'QB_COMPETITION_CONTEXT_LOCKED'; end if;
 if new.content_context_id is null and new.status::text='DRAFT' and new.created_by=auth.uid() then
  perform quizbox_competition.require_member(new.sponsor_id,true);
  return new;
 end if;
 if tg_op='INSERT' or new.content_context_id is distinct from old.content_context_id then
  select * into c from public.content_contexts where id=new.content_context_id and owner_user_id=auth.uid();
  if c.id is null then raise exception 'QB_EXPLICIT_CONTENT_CONTEXT_REQUIRED' using errcode='42501'; end if;
  perform quizbox_market.validate_context(c.scope,c.source_mode,c.market_ids,c.source_document_ids);
 end if;
 if new.status::text='PUBLISHED' and new.content_context_id is null then raise exception 'QB_EXPLICIT_CONTENT_CONTEXT_REQUIRED' using errcode='42501'; end if;
 return new;
end $$;

revoke execute on all functions in schema quizbox_competition from public,anon,authenticated;
grant execute on function quizbox_competition.dispatch(text,uuid,jsonb) to authenticated;
grant execute on function quizbox_competition.raw_question_allowed(uuid) to authenticated;
-- Storage object policies evaluate this as the caller; keep the earlier grant.
grant execute on function quizbox_competition.storage_access(text,boolean) to authenticated;
commit;
