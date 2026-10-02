-- Local preparation only. Extends the existing workspace and SME ledger.
begin;
alter table quizbox_competition.generation_jobs add column execution_count integer not null default 0 check(execution_count>=0);
alter table quizbox_competition.candidates add column primary_assignment_id uuid references public.sme_review_assignments(id);
alter table quizbox_competition.candidates add column senior_assignment_id uuid references public.sme_review_assignments(id);
alter table quizbox_competition.candidates add column approved_version_id uuid references public.question_versions(id);
create table quizbox_competition.candidate_history (
 id uuid primary key default gen_random_uuid(), candidate_id uuid not null references quizbox_competition.candidates(id),
 actor_id uuid not null references public.profiles(id), previous_state text, new_state text not null,
 primary_assignment_id uuid, senior_assignment_id uuid, created_at timestamptz not null default now()
);
alter table quizbox_competition.candidate_history enable row level security;
revoke all on quizbox_competition.candidate_history from public,anon,authenticated;
create trigger immutable_candidate_history before update or delete on quizbox_competition.candidate_history for each row execute function quizbox_competition.reject_mutation();
create function quizbox_competition.capture_candidate_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or new.status is distinct from old.status or new.primary_assignment_id is distinct from old.primary_assignment_id or new.senior_assignment_id is distinct from old.senior_assignment_id then
  insert into quizbox_competition.candidate_history(candidate_id,actor_id,previous_state,new_state,primary_assignment_id,senior_assignment_id)
  values(new.id,auth.uid(),case when tg_op='UPDATE' then old.status end,new.status,new.primary_assignment_id,new.senior_assignment_id);
 end if;
 return new;
end $$;
create trigger sponsor_candidate_history after insert or update on quizbox_competition.candidates for each row execute function quizbox_competition.capture_candidate_history();
alter function quizbox_competition.dispatch(text,uuid,jsonb) rename to dispatch_authoring;

create function quizbox_competition.sync_review() returns trigger language plpgsql security definer set search_path='' as $$
declare candidate quizbox_competition.candidates; work public.sme_review_assignments; target text; senior_required boolean;
begin
 select * into work from public.sme_review_assignments where id=new.assignment_id;
 select * into candidate from quizbox_competition.candidates where question_id=new.question_id
 and (primary_assignment_id=new.assignment_id or senior_assignment_id=new.assignment_id) for update;
 if candidate.id is null then return new; end if;
 select coalesce((configuration->>'seniorReviewRequired')::boolean,false) into senior_required from quizbox_competition.drafts where competition_id=candidate.competition_id;
 target:=case when new.decision='revision' then 'REVISION_REQUIRED' when new.decision='reject' then 'REJECTED'
 when work.review_kind='primary' and senior_required then 'ASSIGNED_FOR_REVIEW' else 'APPROVED' end;
 insert into quizbox_competition.review_events(candidate_id,reviewer_id,assignment_id,decision,previous_state,new_state,notes,started_at,completed_at,policy_context_snapshot)
 values(candidate.id,new.reviewer_id,new.assignment_id,case new.decision when 'revision' then 'REQUEST_REVISION' when 'reject' then 'REJECT' else 'APPROVE' end,
 candidate.status,target,new.review_notes,new.review_started_at,new.review_completed_at,
 jsonb_build_object('policy_version_id',work.compensation_policy_version_id,'compensation_status',case when work.compensation_policy_version_id is null then 'COMPENSATION_UNRESOLVED' else 'POLICY_RESOLVED' end));
 update quizbox_competition.candidates set status=target,approved_version_id=case when target='APPROVED' then new.question_version_id else null end,updated_at=now() where id=candidate.id;
 return new;
end $$;
create trigger sponsor_candidate_review_completion after insert on public.sme_review_events for each row execute function quizbox_competition.sync_review();
create function quizbox_competition.sync_review_start() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.review_started_at is null and new.review_started_at is not null then
  update quizbox_competition.candidates set status='UNDER_REVIEW',updated_at=now()
  where primary_assignment_id=new.id or senior_assignment_id=new.id;
 end if;
 return new;
end $$;
create trigger sponsor_candidate_review_start after update of review_started_at on public.sme_review_assignments for each row execute function quizbox_competition.sync_review_start();

create function quizbox_competition.dispatch(p_action text,p_sponsor uuid,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid; item quizbox_competition.candidates; work public.sme_review_assignments; q public.questions;
 draft quizbox_competition.drafts; job quizbox_competition.generation_jobs; result jsonb; role_name text; kind text;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and lower(status::text)='active') then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>1500000 then raise exception 'INVALID_SPONSOR_INPUT'; end if;
 if p_action='review_queue' then
  return coalesce((select jsonb_agg(jsonb_build_object('candidate_id',x.id,'competition_id',x.competition_id,'assignment_id',w.id,'status',x.status,'review_kind',w.review_kind))
  from quizbox_competition.candidates x join public.sme_review_assignments w on w.id in (x.primary_assignment_id,x.senior_assignment_id)
  where w.reviewer_id=auth.uid() and w.review_completed_at is null
  and quizbox_sme.domain_matches(w.domain_assignment_id,w.question_id,auth.uid(),w.market_id,w.review_kind='senior',false)),'[]');
 end if;
 if p_action in ('review_detail','complete_review') then
  select * into item from quizbox_competition.candidates where id=(p_data->>'candidate_id')::uuid for update;
  select * into work from public.sme_review_assignments where id=(p_data->>'assignment_id')::uuid and id in(item.primary_assignment_id,item.senior_assignment_id) and reviewer_id=auth.uid();
  if work.id is null then raise exception 'QB_REVIEW_ACCESS_DENIED' using errcode='42501'; end if;
  if p_action='review_detail' then
   result:=public.qb_sme_review_detail(work.id);
   if work.review_completed_at is null then update quizbox_competition.candidates set status='UNDER_REVIEW',updated_at=now() where id=item.id; end if;
   return result||jsonb_build_object('candidate_id',item.id);
  end if;
  return public.qb_sme_complete_review(work.id,p_data->>'decision',p_data->>'note',(p_data->>'human_reviewed')::boolean,(p_data->>'version')::integer);
 end if;
 if p_action='oversight' then
  if not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode='42501'; end if;
  return jsonb_build_object('candidates',coalesce((select jsonb_agg(jsonb_build_object('competition_id',competition_id,'status',status,'count',n)) from
   (select competition_id,status,count(*) n from quizbox_competition.candidates group by competition_id,status) x),'[]'),
   'unresolved_compensation',coalesce((select jsonb_agg(to_jsonb(e)) from quizbox_competition.review_events e where e.policy_context_snapshot->>'compensation_status'='COMPENSATION_UNRESOLVED'),'[]'),
   'extraction_failures',coalesce((select jsonb_agg(to_jsonb(d)-'extraction_token') from quizbox_competition.documents d where ingestion_status='FAILED'),'[]'));
 end if;
 if p_action not in ('candidates','assign_candidate','bank','include_bank','retry_generation','claim_generation','fail_generation','finish_generation') then
  return quizbox_competition.dispatch_authoring(p_action,p_sponsor,p_data);
 end if;
 role_name:=quizbox_competition.require_member(p_sponsor,p_action not in ('candidates','bank'));
 c:=(p_data->>'competition_id')::uuid;
 select * into draft from quizbox_competition.drafts where competition_id=c and sponsor_id=p_sponsor for update;
 if draft.competition_id is null then raise exception 'COMPETITION_ACCESS_DENIED' using errcode='42501'; end if;
 if p_action='candidates' then return coalesce((select jsonb_agg(to_jsonb(x)) from quizbox_competition.candidates x where competition_id=c),'[]'); end if;
 if p_action='bank' then return coalesce((select jsonb_agg(to_jsonb(x) order by position) from quizbox_competition.bank_items x where competition_id=c),'[]'); end if;
 if exists(select 1 from quizbox_competition.snapshots where competition_id=c) then raise exception 'COMPETITION_FROZEN'; end if;
 if p_action='retry_generation' then
  select * into job from quizbox_competition.generation_jobs where id=(p_data->>'job_id')::uuid and competition_id=c for update;
  if job.id is null or not (job.status='FAILED' or (job.status='PROCESSING' and job.started_at<now()-interval '10 minutes')) or job.execution_count>=3 or exists(select 1 from quizbox_competition.candidates where job_id=job.id) then raise exception 'GENERATION_NOT_RETRYABLE'; end if;
  update quizbox_competition.generation_jobs set status='QUEUED',execution_token=null,started_at=null,completed_at=null,error_code=null where id=job.id;
  return jsonb_build_object('id',job.id,'status','QUEUED');
 elsif p_action='claim_generation' then
  result:=quizbox_competition.dispatch_authoring(p_action,p_sponsor,p_data);
  update quizbox_competition.generation_jobs set execution_count=execution_count+1 where id=(p_data->>'job_id')::uuid and competition_id=c;
  return result;
 elsif p_action='fail_generation' then
  result:=quizbox_competition.dispatch_authoring(p_action,p_sponsor,p_data);
  update quizbox_competition.generation_jobs set error_code=case when p_data->>'error_code' ~ '^[A-Z][A-Z0-9_]{2,100}$' then p_data->>'error_code' else 'GENERATION_FAILED' end where id=(p_data->>'job_id')::uuid and competition_id=c;
  return result;
 elsif p_action='finish_generation' then
  result:=quizbox_competition.dispatch_authoring(p_action,p_sponsor,p_data);
  if result->>'status'='FAILED' then update quizbox_competition.generation_jobs set error_code='EMPTY_GENERATION_OUTPUT' where id=(p_data->>'job_id')::uuid and competition_id=c; end if;
  return result;
 end if;
 select * into item from quizbox_competition.candidates where id=(p_data->>'candidate_id')::uuid and competition_id=c for update;
 if item.id is null then raise exception 'CANDIDATE_ACCESS_DENIED' using errcode='42501'; end if;
 if p_action='assign_candidate' then
  if not quizbox_sme.has_capability('content_admin') then raise exception 'QB_SME_ASSIGNMENT_DENIED' using errcode='42501'; end if;
  kind:=coalesce(p_data->>'kind','primary');
  if kind not in ('primary','senior') then raise exception 'QB_INVALID_REVIEW_KIND'; end if;
  if kind='primary' and item.primary_assignment_id is not null then
   select * into work from public.sme_review_assignments where id=item.primary_assignment_id;
   if work.reviewer_id is distinct from (p_data->>'reviewer_id')::uuid then raise exception 'REVIEW_ASSIGNMENT_CONFLICT'; end if;
   if not quizbox_sme.domain_matches(work.domain_assignment_id,work.question_id,work.reviewer_id,work.market_id,false,false) then raise exception 'QB_REVIEW_DOMAIN_DENIED' using errcode='42501'; end if;
   return to_jsonb(work);
  end if;
  if kind='senior' and (item.senior_assignment_id is not null or not exists(select 1 from public.sme_review_events where assignment_id=item.primary_assignment_id and decision='approve')) then raise exception 'PRIMARY_REVIEW_REQUIRED'; end if;
  -- Materialization stays with the established content importer. Never invent a
  -- national indicator for document-only candidates to make SME validation pass.
  select * into q from public.questions where id=coalesce(item.question_id,(p_data->>'question_id')::uuid);
  if q.id is null then raise exception 'CANDIDATE_QUESTION_MAPPING_REQUIRED'; end if;
  if q.curriculum_id is distinct from item.curriculum_id or q.question_text is distinct from item.payload->>'stem'
   or q.explanation is distinct from item.payload->>'explanation' or q.subject_code is distinct from item.payload->>'subject'
   or q.option_a is distinct from item.payload#>>'{options,0}' or q.option_b is distinct from item.payload#>>'{options,1}'
   or coalesce(q.option_c,'') is distinct from coalesce(item.payload#>>'{options,2}','') or coalesce(q.option_d,'') is distinct from coalesce(item.payload#>>'{options,3}','')
   or q.correct_answer is distinct from substr('ABCD',(item.payload->>'correctAnswer')::integer+1,1)
   or not (q.source_document_ids @> array[item.source_document_id]) then raise exception 'CANDIDATE_QUESTION_IDENTITY_MISMATCH'; end if;
  result:=public.qb_sme_assign_review(q.id,(p_data->>'reviewer_id')::uuid,(p_data->>'domain_id')::uuid,kind,p_sponsor,
   case when kind='senior' then (select id from public.sme_review_events where assignment_id=item.primary_assignment_id) end);
  update quizbox_competition.candidates set question_id=q.id,status='ASSIGNED_FOR_REVIEW',primary_assignment_id=case when kind='primary' then (result->>'id')::uuid else primary_assignment_id end,
  senior_assignment_id=case when kind='senior' then (result->>'id')::uuid else senior_assignment_id end,updated_at=now() where id=item.id;
  -- The original SME policy resolver pins the exact version at assignment.
  return result;
 elsif p_action='include_bank' then
  if coalesce((p_data->>'included')::boolean,true) then
   if coalesce((draft.configuration->>'totalQuestions')::integer,0) not between 1 and 500 then raise exception 'INVALID_BANK_TARGET'; end if;
   perform quizbox_market.validate_context(draft.configuration->>'scope',draft.configuration->>'sourceMode',
    array(select x::uuid from jsonb_array_elements_text(draft.configuration->'marketIds') x),
    array(select x::uuid from jsonb_array_elements_text(draft.configuration->'sourceIds') x));
   if item.status<>'APPROVED' or item.approved_version_id is null or not exists(select 1 from public.questions bank_question join public.question_versions v on v.question_id=bank_question.id and v.version_no=bank_question.version where bank_question.id=item.question_id and bank_question.validation_status='approved' and v.id=item.approved_version_id)
   or exists(select 1 from public.sme_review_assignments where id in(item.primary_assignment_id,item.senior_assignment_id) and review_completed_at is null)
   or not coalesce(draft.configuration->'sourceIds' @> jsonb_build_array(item.source_document_id),false)
   or not exists(select 1 from public.source_documents where id=item.source_document_id and validation_status='approved' and rights_confirmed) then raise exception 'UNAPPROVED_BANK_OR_PROVENANCE'; end if;
   if (select count(*) from quizbox_competition.bank_items where competition_id=c and included and candidate_id<>item.id)>=(draft.configuration->>'totalQuestions')::integer then raise exception 'BANK_TARGET_COUNT_EXCEEDED'; end if;
   insert into quizbox_competition.bank_items(competition_id,candidate_id,question_version_id,position,included)
   values(c,item.id,item.approved_version_id,(p_data->>'position')::integer,true)
   on conflict(competition_id,candidate_id) do update set included=true,question_version_id=excluded.question_version_id,position=excluded.position;
  else update quizbox_competition.bank_items set included=false where competition_id=c and candidate_id=item.id; end if;
  return jsonb_build_object('saved',true);
 end if;
 raise exception 'INVALID_SPONSOR_ACTION';
end $$;
revoke all on function quizbox_competition.dispatch_authoring(text,uuid,jsonb),quizbox_competition.sync_review(),quizbox_competition.sync_review_start(),quizbox_competition.capture_candidate_history(),quizbox_competition.dispatch(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function quizbox_competition.dispatch(text,uuid,jsonb) to authenticated;
-- Rebind the public SQL entrypoint explicitly; the original function OID was renamed.
create or replace function public.qb_sponsor_workspace(p_action text,p_sponsor uuid default null,p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$ select quizbox_competition.dispatch(p_action,p_sponsor,p_data); $$;
commit;
