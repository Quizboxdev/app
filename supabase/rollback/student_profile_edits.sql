-- Rollback for 20261066100000_student_profile_edits.sql: learners can no longer edit their class level, school or subjects themselves, and the record of past edits is dropped.
-- Profile values already changed stay as they are; the audit_logs entries ('student_profile_edited') are kept.
begin;
drop function if exists public.qb_update_student_profile(text, text, text[]);
drop function if exists public.qb_profile_edit_status();
drop table if exists public.student_profile_edits;
commit;
notify pgrst, 'reload schema';
