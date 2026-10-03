begin;
do $$ begin
 if exists(select 1 from quizbox_competition.registrations)
 or exists(select 1 from quizbox_competition.invitations)
 or exists(select 1 from quizbox_competition.official_results)
 or exists(select 1 from quizbox_competition.leaderboard)
 or exists(select 1 from public.questions where origin_candidate_id is not null or content_origin<>'CURRICULUM' or grade is null)
 or exists(select 1 from public.assessments where competition_snapshot_id is not null or source_mode is not null or grade is null)
 or exists(select 1 from public.sme_review_assignments where candidate_id is not null)
 or exists(select 1 from public.sme_review_events where candidate_id is not null)
 or exists(select 1 from quizbox_competition.candidates where review_revision<>1) then
  raise exception 'ROLLBACK_REQUIRES_ARCHIVE_AND_ISOLATED_RESTORE';
 end if;
end $$;
drop policy sponsor_answer_isolation on public.questions;
drop trigger immutable_competition_assessment on public.assessments;
drop trigger immutable_competition_delivery on public.assessment_questions;
drop trigger competition_official_result on public.assessment_results;
drop trigger competition_attempt_capture on public.attempts;

-- Restore the preserved originals in place so existing OIDs, grants and policies are kept.
do $$ begin
 execute replace(pg_get_functiondef('quizbox_competition.engine_attempt_review(uuid)'::regprocedure),'FUNCTION quizbox_competition.engine_attempt_review','FUNCTION public.qb_get_attempt_review');
 execute replace(pg_get_functiondef('quizbox_competition.curriculum_question_allowed(uuid,jsonb)'::regprocedure),'FUNCTION quizbox_competition.curriculum_question_allowed','FUNCTION quizbox_market.question_allowed');
 execute replace(pg_get_functiondef('quizbox_competition.curriculum_question_guard()'::regprocedure),'FUNCTION quizbox_competition.curriculum_question_guard','FUNCTION quizbox_market.question_guard');
 execute replace(pg_get_functiondef('quizbox_competition.curriculum_validation_errors(jsonb)'::regprocedure),'FUNCTION quizbox_competition.curriculum_validation_errors','FUNCTION public.qb_content_validation_errors');
 execute replace(pg_get_functiondef('quizbox_competition.curriculum_assessment_allowed(uuid)'::regprocedure),'FUNCTION quizbox_competition.curriculum_assessment_allowed','FUNCTION quizbox_market.assessment_allowed');
end $$;
create or replace function quizbox_market.competition_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.content_contexts;
begin
 if auth.uid() is null then return new; end if;
 if tg_op='UPDATE' and old.content_context_id is not null and new.content_context_id is distinct from old.content_context_id then raise exception 'QB_COMPETITION_CONTEXT_LOCKED'; end if;
 if tg_op='INSERT' or new.content_context_id is distinct from old.content_context_id then
  select * into c from public.content_contexts where id=new.content_context_id and owner_user_id=auth.uid();
  if c.id is null then raise exception 'QB_EXPLICIT_CONTENT_CONTEXT_REQUIRED' using errcode='42501'; end if;
  perform quizbox_market.validate_context(c.scope,c.source_mode,c.market_ids,c.source_document_ids);
 end if; return new;
end $$;

create or replace function public.qb_sponsor_workspace(p_action text,p_sponsor uuid default null,p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$ select quizbox_competition.dispatch_review_bridge(p_action,p_sponsor,p_data); $$;
drop function quizbox_competition.dispatch(text,uuid,jsonb);
alter function quizbox_competition.dispatch_review_bridge(text,uuid,jsonb) rename to dispatch;
create or replace function public.qb_sponsor_workspace(p_action text,p_sponsor uuid default null,p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$ select quizbox_competition.dispatch(p_action,p_sponsor,p_data); $$;
grant execute on function quizbox_competition.dispatch(text,uuid,jsonb) to authenticated;

drop function quizbox_competition.protect_assessment();
drop function quizbox_competition.raw_question_allowed(uuid);
drop function quizbox_competition.publication_blockers(uuid,boolean);
drop function quizbox_competition.earn_review(public.sme_review_assignments,public.sme_review_events);
drop function quizbox_competition.question_provenance(jsonb);
drop function quizbox_competition.protect_delivery();
drop function quizbox_competition.capture_result();
drop function quizbox_competition.capture_attempt();
drop function quizbox_competition.candidate_errors(jsonb);
drop function quizbox_competition.senior_required(uuid);
drop function quizbox_competition.candidate_domain(uuid,uuid,uuid,boolean,boolean);
drop function quizbox_competition.source_valid(uuid);
drop function quizbox_competition.engine_attempt_review(uuid);
drop function quizbox_competition.curriculum_question_allowed(uuid,jsonb);
drop function quizbox_competition.curriculum_question_guard();
drop function quizbox_competition.curriculum_validation_errors(jsonb);
drop function quizbox_competition.curriculum_assessment_allowed(uuid);

drop table quizbox_competition.leaderboard;
drop table quizbox_competition.official_results;
drop table quizbox_competition.invitations;
drop table quizbox_competition.registrations;

alter table public.assessments drop constraint assessment_grade_semantics;
alter table public.assessments alter column grade set not null;
alter table public.assessments drop column source_mode, drop column competition_snapshot_id;
alter table public.questions drop constraint question_grade_semantics;
alter table public.questions alter column grade set not null;
alter table public.questions drop column origin_metadata, drop column origin_candidate_id, drop column content_origin;
alter table public.sme_review_events drop constraint sme_event_origin;
alter table public.sme_review_events drop column candidate_id;
alter table public.sme_review_events alter column question_id set not null;
drop index public.candidate_one_open_review;
alter table public.sme_review_assignments drop constraint sme_work_origin;
alter table public.sme_review_assignments drop column candidate_id;
alter table public.sme_review_assignments alter column question_id set not null;
alter table quizbox_competition.candidates drop column review_revision;
commit;
