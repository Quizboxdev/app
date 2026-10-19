-- Rollback for 20261019120000_reviewer_applications. Reviewer profiles and domains already granted are untouched; the added decision columns stay (harmless).
drop function if exists public.qb_reviewer_application_decide(uuid, text, text, jsonb);
drop function if exists public.qb_reviewer_applications(text);
drop function if exists public.qb_my_reviewer_application();
drop function if exists public.qb_apply_reviewer(jsonb);
