begin;
-- A learner who joins a class after a teacher has published work to it now receives that work.
-- Before this, assignment targets were written only at the moment of publishing, for the learners in the class at that moment. A learner who joined later
-- (or came back after leaving) saw "No assignments yet" and "You are all caught up" (Spark run SPK-1117A, 2026-11-17, found while diagnosing row 1).
-- A trigger covers every way into a class: join code, rejoining, and placement by staff.
-- Only open, class-wide work is added: published, sent to the whole class, and not past its due date. Work sent to chosen learners only is never added.
-- Family classes are left alone: parents choose which children get each piece of work there.
-- The one-off backfill at the end gives current members any open class-wide work they are missing. It only adds rows that do not exist.
-- Rollback: supabase/rollback/class_join_assignment_catch_up.sql

create or replace function quizbox_private.catch_up_assignment_targets() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  if new.status <> 'active'::public.qb_status or new.student_id is null then return new; end if;
  if exists (select 1 from public.classes c where c.id = new.class_id and c.family_workspace_id is not null) then return new; end if;
  insert into public.assignment_targets(assignment_id, class_id, student_id, membership_id, status)
  select a.id, a.class_id, new.student_id, new.id, 'active'::public.qb_status
    from public.assignments a
   where a.class_id = new.class_id and a.status = 'published'::public.assignment_status and a.recipient_mode = 'class'::public.recipient_mode
     and (a.due_at is null or a.due_at > now())
  on conflict (assignment_id, student_id) do nothing;
  return new;
end $fn$;
revoke all on function quizbox_private.catch_up_assignment_targets() from public, anon, authenticated;

drop trigger if exists class_membership_catch_up on public.class_memberships;
create trigger class_membership_catch_up after insert or update of status on public.class_memberships
  for each row execute function quizbox_private.catch_up_assignment_targets();

insert into public.assignment_targets(assignment_id, class_id, student_id, membership_id, status)
select a.id, a.class_id, m.student_id, m.id, 'active'::public.qb_status
  from public.assignments a
  join public.class_memberships m on m.class_id = a.class_id and m.status = 'active'::public.qb_status and m.student_id is not null
  join public.classes c on c.id = a.class_id and c.family_workspace_id is null
 where a.status = 'published'::public.assignment_status and a.recipient_mode = 'class'::public.recipient_mode and (a.due_at is null or a.due_at > now())
on conflict (assignment_id, student_id) do nothing;

commit;
notify pgrst, 'reload schema';
