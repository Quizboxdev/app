-- A learner's class card: who teaches the class, how many learners are in it, and how much work is open. One read for the signed-in learner, own classes only.
-- The teacher's name is shown because a learner must be able to tell which teacher a class belongs to; no email or phone is returned.
create or replace function public.qb_student_class_cards() returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
      'class_id', c.id,
      'teacher_name', nullif(btrim(p.full_name), ''),
      'learners', (select count(*) from public.class_memberships m2 where m2.class_id = c.id and m2.status = 'active'::public.qb_status),
      'open_assignments', (select count(*) from public.assignments a where a.class_id = c.id and a.status = 'published'::public.assignment_status and (a.due_at is null or a.due_at > now()))
    ) order by m.joined_at desc), '[]'::jsonb)
    from public.class_memberships m
    join public.classes c on c.id = m.class_id
    left join public.profiles p on p.id = c.teacher_user_id
   where m.student_user_id = auth.uid() and m.status = 'active'::public.qb_status;
$fn$;
revoke all on function public.qb_student_class_cards() from public, anon;
grant execute on function public.qb_student_class_cards() to authenticated;
