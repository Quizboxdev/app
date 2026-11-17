begin;

-- Removes the alumni application guard, its functions and the applications table (the applications are deleted).
drop trigger if exists family_workspace_guard on public.family_workspaces;
drop function if exists quizbox_core.family_workspace_guard();
drop function if exists quizbox_core.family_creation_allowed(uuid);
drop function if exists public.qb_family_apply(text, text, text);
drop function if exists public.qb_family_my_application();
drop function if exists public.qb_family_applications_pending();
drop function if exists public.qb_family_application_decide(uuid, boolean, text);
drop table if exists public.sponsor_family_applications;

commit;
