-- Reverse 20261005100000 (Content Factory + SME workforce). Refuses once campaigns, policies or scheduler
-- history exist: generated questions, assignments and earnings live in the core tables and are never removed here.
begin;
do $$ begin
 if exists(select 1 from quizbox_factory.campaigns) or exists(select 1 from quizbox_factory.workload_policies) or exists(select 1 from quizbox_factory.scheduler_runs)
  or exists(select 1 from public.sme_review_assignments where released_at is not null) then
  raise exception 'CONTENT_FACTORY_ROLLBACK_REFUSED_DATA_EXISTS';
 end if;
end $$;
drop trigger if exists factory_review_counts on public.sme_review_events;
drop function if exists public.qb_sme_workforce(text,jsonb);
drop function if exists public.qb_content_factory_import(jsonb);
drop function if exists public.qb_content_factory(text,jsonb);
drop schema quizbox_factory cascade;
drop index if exists public.sme_assignments_released_by;
alter table public.sme_review_assignments drop column if exists release_reason, drop column if exists released_by, drop column if exists released_at;
commit;
