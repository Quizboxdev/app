-- Rollback for 20261120100000_learner_profile_write_guards.sql. Restores the previous rules exactly (including the weaknesses D-01 to D-04).
-- Only use it if the correction itself breaks a screen; then fix forward. One transaction.
begin;
drop trigger if exists class_join_code_guard on public.classes;
drop function if exists quizbox_private.class_join_code_guard();
drop index if exists public.classes_join_code_upper_key;

drop policy if exists assignments_teacher_owner on public.assignments;
create policy assignments_teacher_owner on public.assignments for all
  using (teacher_user_id = (select auth.uid())) with check (teacher_user_id = (select auth.uid()));

grant insert, update, delete on public.student_profiles to authenticated;
grant insert, update, delete on public.teacher_profiles to authenticated;
drop policy if exists student_self_read on public.student_profiles;
create policy student_self on public.student_profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists teacher_self_read on public.teacher_profiles;
create policy teacher_self on public.teacher_profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
commit;
