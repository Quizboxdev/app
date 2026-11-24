-- Who may author: an active teacher, staff, a verified ORGANIZATION or ALUMNI sponsor, or a sponsor (parent, alumni) who has a family workspace while that workspace is open.
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
    if quizbox_mock.link_sponsor(auth.uid()) then return 'sponsor'; end if;
    if coalesce(quizbox_core.flag('flags.family_workspace'), false) and exists (select 1 from public.family_workspaces w where w.owner_user_id = auth.uid())
       and exists (select 1 from public.sponsor_profiles s where s.user_id = auth.uid() and lower(coalesce(s.status::text, 'active')) = 'active') then return 'sponsor'; end if;
    raise exception 'QB_MOCK_SPONSOR_NOT_VERIFIED' using errcode = '42501';
  end if;
  raise exception 'QB_MOCK_AUTHOR_FORBIDDEN' using errcode = '42501';
end $fn$;

-- May this person use this copy right now: a live purchase, or a live gift (family or link).
create or replace function quizbox_mock.entitled(p_assessment uuid, p_user uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.mock_exam_enrolments en join public.mk_purchases p on p.id = en.purchase_id
                  where en.assessment_id = p_assessment and en.student_user_id = p_user and p.buyer_user_id = p_user and p.status = 'active' and p.expires_at > now())
      or exists (select 1 from public.mock_exam_enrolments en join public.mock_exam_grants g on g.id = en.grant_id
                  where en.assessment_id = p_assessment and en.student_user_id = p_user and g.student_user_id = p_user and g.status = 'active' and g.expires_at > now())
$fn$;

-- Opens the private copy for a gift or a join, once.
create or replace function quizbox_mock.ensure_grant_enrolment(p_grant uuid) returns uuid language plpgsql security definer set search_path = '' as $fn$
declare g public.mock_exam_grants; en public.mock_exam_enrolments; a_id uuid;
begin
  select * into g from public.mock_exam_grants where id = p_grant for update;
  if g.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into en from public.mock_exam_enrolments where grant_id = g.id;
  if en.id is not null then return en.id; end if;
  a_id := quizbox_mock.open_copy(g.version_id, g.student_user_id, g.expires_at);
  insert into public.mock_exam_enrolments(exam_id, version_id, student_user_id, purchase_id, grant_id, assessment_id) values (g.exam_id, g.version_id, g.student_user_id, null, g.id, a_id) returning * into en;
  update public.assessments set reference_id = en.id where id = a_id;
  return en.id;
end $fn$;

-- Every attempt the owner may see: class attempts (with names), gifts to the family (with names), joiners by link ("Joiner N", no identity) and Marketplace buyers ("Buyer N").
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
   where en.exam_id = p_exam and en.purchase_id is not null
  union all
  select a.id, 'family'::text, 'Family', null::uuid, a.student_user_id, coalesce(p.full_name, 'Learner'),
         (row_number() over (partition by a.student_user_id, a.assessment_id order by a.started_at))::integer, a.status::text, a.started_at, a.submitted_at, a.score, a.total_marks, a.percentage, a.assessment_id, en.version_id
    from public.mock_exam_enrolments en join public.mock_exam_grants g on g.id = en.grant_id and g.kind = 'family' and g.granted_by = auth.uid()
    join public.attempts a on a.assessment_id = en.assessment_id left join public.profiles p on p.id = a.student_user_id
   where en.exam_id = p_exam
  union all
  select a.id, 'link'::text, 'Shared link', null::uuid, a.student_user_id, 'Joiner ' || (dense_rank() over (order by en.created_at, en.id))::text,
         (row_number() over (partition by a.student_user_id, a.assessment_id order by a.started_at))::integer, a.status::text, a.started_at, a.submitted_at, a.score, a.total_marks, a.percentage, a.assessment_id, en.version_id
    from public.mock_exam_enrolments en join public.mock_exam_grants g on g.id = en.grant_id and g.kind = 'link'
    join public.attempts a on a.assessment_id = en.assessment_id
   where en.exam_id = p_exam
$fn$;
