-- Rollback for 20261118110000_class_join_assignment_catch_up.sql: joining a class no longer adds earlier assignments.
-- Targets already added stay (they are real rows that learners may have started); remove them by hand only if that is wanted.
begin;
drop trigger if exists class_membership_catch_up on public.class_memberships;
drop function if exists quizbox_private.catch_up_assignment_targets();
commit;
notify pgrst, 'reload schema';
