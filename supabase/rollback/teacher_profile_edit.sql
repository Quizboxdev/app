-- Rollback for 20261069100000_teacher_profile_edit.sql: teachers can no longer edit their own details here. Details already changed stay as they are; the edit history and the flag row are removed.
begin;
drop function if exists public.qb_update_teacher_profile(text, text, text[], text[]);
drop function if exists public.qb_teacher_profile_status();
drop table if exists public.account_profile_edits;
delete from public.platform_settings where key = 'flags.teacher_profile_edit' and scope_type = 'global';
commit;
notify pgrst, 'reload schema';
