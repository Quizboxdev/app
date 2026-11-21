drop function if exists public.qb_admin_sponsor_decide(uuid, text, text);
drop function if exists public.qb_admin_sponsor_queue(text);
-- The three columns are kept on purpose: they hold decisions people made. Drop them by hand only if you are sure:
--   alter table public.sponsor_profiles drop column verification_note, drop column verified_at, drop column verified_by;
