begin;
do $$ begin
 if exists(select 1 from quizbox_competition.candidate_history)
 or exists(select 1 from quizbox_competition.candidates where primary_assignment_id is not null or senior_assignment_id is not null or approved_version_id is not null)
 or exists(select 1 from quizbox_competition.generation_jobs where execution_count>0) then
  raise exception 'ROLLBACK_REQUIRES_ARCHIVE_AND_ISOLATED_RESTORE';
 end if;
end $$;
drop trigger sponsor_candidate_review_completion on public.sme_review_events;
drop trigger sponsor_candidate_review_start on public.sme_review_assignments;
drop trigger sponsor_candidate_history on quizbox_competition.candidates;
create or replace function public.qb_sponsor_workspace(p_action text,p_sponsor uuid default null,p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$ select quizbox_competition.dispatch_authoring(p_action,p_sponsor,p_data); $$;
drop function quizbox_competition.dispatch(text,uuid,jsonb);
alter function quizbox_competition.dispatch_authoring(text,uuid,jsonb) rename to dispatch;
create or replace function public.qb_sponsor_workspace(p_action text,p_sponsor uuid default null,p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$ select quizbox_competition.dispatch(p_action,p_sponsor,p_data); $$;
grant execute on function quizbox_competition.dispatch(text,uuid,jsonb) to authenticated;
drop function quizbox_competition.sync_review();
drop function quizbox_competition.sync_review_start();
drop function quizbox_competition.capture_candidate_history();
drop table quizbox_competition.candidate_history;
alter table quizbox_competition.candidates drop column primary_assignment_id,drop column senior_assignment_id,drop column approved_version_id;
alter table quizbox_competition.generation_jobs drop column execution_count;
commit;
