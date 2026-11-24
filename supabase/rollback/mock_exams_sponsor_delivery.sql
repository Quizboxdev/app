-- Rollback for 20261124130000_mock_exams_sponsor_delivery.sql: removes the family-gift and shared-link functions and puts back the earlier author rule, entitlement check and attempt listing.
-- KEPT on purpose: the tables mock_exam_links and mock_exam_grants, the grant_id column and every private copy, attempt and result (they record who was given what and what they answered), and the Coins already paid for places.
-- After this, gifted copies cannot start new attempts (the entitlement check no longer knows gifts); take a note of any open links first, as people who paid for places cannot be refunded by this script.
begin;
do $$ declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('qb_mock_family_give', 'qb_mock_family_revoke', 'qb_mock_family_given', 'qb_mock_link_create',
      'qb_mock_link_add_seats', 'qb_mock_link_close', 'qb_mock_links', 'qb_mock_link_info', 'qb_mock_link_join', 'qb_mock_my_grants', 'qb_mock_start_granted') loop
    execute 'drop function if exists ' || f.sig;
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'quizbox_mock'::regnamespace and p.proname in ('link_sponsor', 'ensure_grant_enrolment', 'link_owner', 'link_json') loop
    execute 'drop function if exists ' || f.sig;
  end loop;
end $$;

-- The earlier versions, as they were in the three migrations before this one.
create or replace function quizbox_mock.author_kind() returns text language plpgsql stable security definer set search_path = '' as $fn$
declare r text; st text;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not coalesce(quizbox_core.flag('flags.mock_exams'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  select upper(p.role::text), lower(p.status::text) into r, st from public.profiles p where p.id = auth.uid();
  if st is distinct from 'active' then raise exception 'QB_MOCK_AUTHOR_FORBIDDEN' using errcode = '42501'; end if;
  if r = 'TEACHER' then return 'teacher'; end if;
  if r in ('ADMIN', 'OWNER') then return 'staff'; end if;
  if r = 'SPONSOR' then
    if exists (select 1 from public.sponsor_profiles s where s.user_id = auth.uid() and upper(coalesce(s.sponsor_type, 'ORGANIZATION')) = 'ORGANIZATION' and upper(coalesce(s.verification_status, '')) = 'VERIFIED' and lower(coalesce(s.status::text, 'active')) = 'active') then return 'sponsor'; end if;
    raise exception 'QB_MOCK_SPONSOR_NOT_VERIFIED' using errcode = '42501';
  end if;
  raise exception 'QB_MOCK_AUTHOR_FORBIDDEN' using errcode = '42501';
end $fn$;

create or replace function quizbox_mock.entitled(p_assessment uuid, p_user uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.mock_exam_enrolments en join public.mk_purchases p on p.id = en.purchase_id
                  where en.assessment_id = p_assessment and en.student_user_id = p_user and p.buyer_user_id = p_user and p.status = 'active' and p.expires_at > now())
$fn$;

create or replace function quizbox_mock.attempt_rows(p_exam uuid) returns table(attempt_id uuid, source text, group_label text, class_id uuid, participant_key uuid, participant text, attempt_no integer, state text,
  started_at timestamptz, submitted_at timestamptz, score numeric, total_marks numeric, percentage numeric, assessment_id uuid, version_id uuid)
language sql stable security definer set search_path = '' as $fn$
  select a.id, 'class'::text, c.class_name, x.class_id, a.student_user_id, coalesce(p.full_name, 'Learner'),
         (row_number() over (partition by a.student_user_id, a.assessment_id order by a.started_at))::integer, a.status::text, a.started_at, a.submitted_at, a.score, a.total_marks, a.percentage, a.assessment_id, ma.version_id
    from public.mock_exam_assignments ma join public.assignments x on x.id = ma.assignment_id join public.attempts a on a.assignment_id = x.id
    join public.classes c on c.id = x.class_id left join public.profiles p on p.id = a.student_user_id
   where ma.exam_id = p_exam and (x.teacher_user_id = auth.uid() or public.qb_can_manage_class(x.class_id))
  union all
  select a.id, 'market'::text, 'Marketplace', null::uuid, a.student_user_id, 'Buyer ' || (dense_rank() over (order by en.created_at, en.id))::text,
         (row_number() over (partition by a.student_user_id, a.assessment_id order by a.started_at))::integer, a.status::text, a.started_at, a.submitted_at, a.score, a.total_marks, a.percentage, a.assessment_id, en.version_id
    from public.mock_exam_enrolments en join public.attempts a on a.assessment_id = en.assessment_id
   where en.exam_id = p_exam
$fn$;

commit;
notify pgrst, 'reload schema';
