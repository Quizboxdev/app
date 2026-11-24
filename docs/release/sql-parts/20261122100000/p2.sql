create trigger mock_exam_version_questions_freeze before update or delete on public.mock_exam_version_questions for each row execute function quizbox_mock.freeze();

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function quizbox_mock.num(p_key text, p_default numeric) returns numeric language sql stable security definer set search_path = '' as $fn$
  select coalesce(nullif(quizbox_core.setting(p_key) #>> '{}', '')::numeric, p_default);
$fn$;

-- Levels in order. B10 is the legacy code for SHS 1.
create or replace function quizbox_mock.canon(p_grade text) returns text language sql immutable set search_path = '' as $fn$
  select case when upper(btrim(coalesce(p_grade, ''))) = 'B10' then 'SHS1' else upper(btrim(coalesce(p_grade, ''))) end
$fn$;
create or replace function quizbox_mock.grade_rank(p_grade text) returns integer language sql immutable set search_path = '' as $fn$
  select case quizbox_mock.canon(p_grade) when 'B1' then 1 when 'B2' then 2 when 'B3' then 3 when 'B4' then 4 when 'B5' then 5 when 'B6' then 6 when 'B7' then 7 when 'B8' then 8 when 'B9' then 9
    when 'SHS1' then 10 when 'SHS2' then 11 when 'SHS3' then 12 else null end
$fn$;
create or replace function quizbox_mock.stage(p_grade text) returns text language sql immutable set search_path = '' as $fn$
  select case when quizbox_mock.grade_rank(p_grade) between 1 and 6 then 'PRIMARY' when quizbox_mock.grade_rank(p_grade) between 7 and 9 then 'JHS' when quizbox_mock.grade_rank(p_grade) between 10 and 12 then 'SHS' end
$fn$;
-- A level may feed a target exam when it is in the same stage and not above the target year.
create or replace function quizbox_mock.eligible(p_target text, p_grade text) returns boolean language sql immutable set search_path = '' as $fn$
  select quizbox_mock.stage(p_target) is not null and quizbox_mock.stage(p_target) = quizbox_mock.stage(p_grade) and quizbox_mock.grade_rank(p_grade) <= quizbox_mock.grade_rank(p_target)
$fn$;

-- Who may author: an active teacher, an active organisation sponsor whose verification is VERIFIED, or staff.
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

-- A curriculum the author may use: active, and in the author's own market (any market when the profile has none).
create or replace function quizbox_mock.curriculum_ok(p_curriculum uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.curricula c join public.market_curricula mc on mc.curriculum_id = c.id and mc.active
                  where c.id = p_curriculum and c.status = 'ACTIVE'
                    and ((select p.default_market_id from public.profiles p where p.id = auth.uid()) is null or mc.market_id = (select p.default_market_id from public.profiles p where p.id = auth.uid())))
$fn$;

create or replace function quizbox_mock.own_exam(p_exam uuid, p_lock boolean default false) returns public.mock_exams language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams;
begin
  perform quizbox_mock.author_kind();
  if p_lock then select * into e from public.mock_exams where id = p_exam and owner_user_id = auth.uid() for update;
  else select * into e from public.mock_exams where id = p_exam and owner_user_id = auth.uid(); end if;
  if e.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  return e;
end $fn$;

-- The identity of a question for duplicate checks: its duplicate group, else its text hash (the loader's own formula), else itself.
create or replace function quizbox_mock.dup_key(q public.questions) returns text language sql immutable set search_path = '' as $fn$
  select coalesce(q.duplicate_group_id, case when q.text_hash is not null then 'dup-' || q.text_hash end, q.id::text)
$fn$;

-- Every question id that may not be added again: the ones already in the exam, and any question that is a duplicate of one of them.
create or replace function quizbox_mock.taken(p_exam uuid) returns uuid[] language sql stable security definer set search_path = '' as $fn$
  with sel as (select q.id, q.text_hash, q.duplicate_group_id from public.mock_exam_questions s join public.questions q on q.id = s.question_id where s.exam_id = p_exam)
  select coalesce(array_agg(distinct x.id), '{}'::uuid[]) from (
    select sel.id from sel
    union select q.id from public.questions q where q.text_hash = any (select text_hash from sel where text_hash is not null)                              -- indexed: same text
    union select q.id from public.questions q where q.duplicate_group_id = any (select duplicate_group_id from sel where duplicate_group_id is not null)  -- the loader's duplicate group
  ) x;
$fn$;

create or replace function quizbox_mock.subject_label(p_curriculum uuid, p_grade text, p_subject text) returns text language sql stable security definer set search_path = '' as $fn$
  select coalesce((select n.title from public.curriculum_nodes n where n.curriculum_id = p_curriculum and n.node_type = 'subject' and n.subject_code = p_subject
                    and quizbox_mock.canon(coalesce(n.canonical_grade_code, n.grade_code)) = quizbox_mock.canon(p_grade) order by n.sort_order limit 1), p_subject)
$fn$;

-- The state of every round: what was asked, what is chosen, what could still be added, and how many are missing for good.
create or replace function quizbox_mock.rounds_json(e public.mock_exams) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_taken uuid[] := quizbox_mock.taken(e.id); v_tenant uuid := public.qb_public_tenant_id();
begin
  return coalesce((select jsonb_agg(x.j order by x.position) from (
    select r.position, jsonb_build_object('id', r.id, 'position', r.position, 'grade_code', r.grade_code, 'subject_code', r.subject_code,
      'subject_label', quizbox_mock.subject_label(e.curriculum_id, r.grade_code, r.subject_code), 'topic_id', r.topic_id, 'topic_title', t.title,
      'strand', quizbox_topic.ancestor_title(t.indicator_node_id, 'strand'), 'indicator_code', n.code, 'requested', r.requested,
      'selected', coalesce(s.n, 0), 'available', a.total, 'available_to_add', a.free,
      'shortfall', greatest(r.requested - coalesce(s.n, 0) - a.free, 0)) as j
    from public.mock_exam_rounds r join public.curriculum_topics t on t.id = r.topic_id join public.curriculum_nodes n on n.id = t.indicator_node_id
    left join lateral (select count(*)::integer as n from public.mock_exam_questions q where q.round_id = r.id) s on true
    cross join lateral (select count(*)::integer as total, count(*) filter (where not (l.question_id = any (v_taken)))::integer as free from quizbox_topic.listable_questions(r.topic_id, v_tenant, false) l) a
    where r.exam_id = e.id) x), '[]'::jsonb);
end $fn$;
