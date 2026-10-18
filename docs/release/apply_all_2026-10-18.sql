-- QuizBox apply pack, 18 October 2026: steps 1 to 5 in one paste. Each step is its own transaction and safe to run twice.
-- If the SQL editor cuts the paste short, run the steps one at a time from docs/release/APPLY_2026-10-18.md.

-- ============ 1. Owner batch approval (corrected, no quizbox_core) ============
begin;
create or replace function public.qb_owner_batch_preview(p_batch uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare b public.question_load_batches; tag text; total integer; by_state jsonb; valid integer; avail integer; sample jsonb;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  select * into b from public.question_load_batches where id = p_batch;
  if b.id is null then raise exception 'QB_BATCH_NOT_FOUND'; end if;
  tag := 'source:QL:' || b.id || ':%';
  select count(*)::integer into total from public.questions q cross join lateral unnest(q.tags) t where t like tag;
  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into by_state from (
    select q.validation_status || '/' || q.status::text as k, count(*) as n from public.questions q
     where exists (select 1 from unnest(q.tags) t where t like tag) group by 1) s;
  select count(*)::integer into valid from public.questions q where exists (select 1 from unnest(q.tags) t where t like tag)
     and q.validation_status = 'review' and public.qb_content_validation_errors(to_jsonb(q)) = '[]'::jsonb;
  select count(*)::integer into avail from public.questions q where exists (select 1 from unnest(q.tags) t where t like tag) and public.qb_question_is_available(q);
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'question', question_text, 'a', option_a, 'b', option_b, 'c', option_c, 'd', option_d, 'correct', correct_answer, 'difficulty', difficulty_label)), '[]'::jsonb)
    into sample from (select * from public.questions q where exists (select 1 from unnest(q.tags) t where t like tag) order by random() limit 20) s;
  return jsonb_build_object('batch_id', b.id, 'file', b.file_name, 'batch_status', b.status, 'questions_found', total, 'by_state', by_state,
    'would_approve', valid, 'already_available_to_learners', avail,
    'min_sample_required', 20, 'sample', sample);
end $fn$;

create or replace function public.qb_owner_approve_batch(p_batch uuid, p_note text, p_sample_reviewed integer, p_publish boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare b public.question_load_batches; tag text; need integer; a public.question_batch_approvals; ok_count integer; found integer;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  select * into b from public.question_load_batches where id = p_batch for update;
  if b.id is null then raise exception 'QB_BATCH_NOT_FOUND'; end if;
  if b.status not in ('LOADED', 'PARTIAL') then raise exception 'QB_BATCH_NOT_LOADED'; end if;
  if exists (select 1 from public.question_batch_approvals where batch_id = b.id and status = 'ACTIVE') then raise exception 'QB_BATCH_ALREADY_APPROVED'; end if;
  need := 20;
  if p_sample_reviewed is null or p_sample_reviewed < need then raise exception 'QB_OWNER_SAMPLE_TOO_SMALL'; end if;
  if length(btrim(coalesce(p_note, ''))) not between 10 and 1000 then raise exception 'QB_APPROVAL_NOTE_REQUIRED'; end if;
  tag := 'source:QL:' || b.id || ':%';

  insert into public.question_batch_approvals(batch_id, approved_by, note, sample_reviewed, published)
  values (b.id, auth.uid(), btrim(p_note), p_sample_reviewed, coalesce(p_publish, true)) returning * into a;

  -- Only this function sets the flag, for this transaction only, after the super-admin check above.
  perform set_config('quizbox.owner_batch', 'on', true);
  update public.questions q set validation_status = 'approved', status = 'inactive',
         reviewed_by = auth.uid(), reviewed_at = now(),
         editorial_metadata = coalesce(q.editorial_metadata, '{}'::jsonb) || jsonb_build_object('human_reviewed', true, 'approval_basis', 'OWNER_BATCH', 'approval_id', a.id,
                                'review_note', 'Owner-approved batch after a sample read (not subject-expert reviewed)')
   where exists (select 1 from unnest(q.tags) t where t like tag) and q.validation_status = 'review' and public.qb_content_validation_errors(to_jsonb(q)) = '[]'::jsonb;
  get diagnostics ok_count = row_count;
  if a.published then update public.questions set status = 'active' where editorial_metadata ->> 'approval_id' = a.id::text and validation_status = 'approved'; end if;
  perform set_config('quizbox.owner_batch', 'off', true);

  select count(*)::integer into found from public.questions q where exists (select 1 from unnest(q.tags) t where t like tag);
  update public.question_batch_approvals set questions_approved = ok_count, questions_skipped = found - ok_count where id = a.id returning * into a;
  return jsonb_build_object('approval_id', a.id, 'questions_found', found, 'approved', ok_count, 'skipped', found - ok_count, 'published', a.published);
end $fn$;

create or replace function public.qb_owner_revoke_batch_approval(p_approval uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare a public.question_batch_approvals; n integer;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  select * into a from public.question_batch_approvals where id = p_approval for update;
  if a.id is null then raise exception 'QB_APPROVAL_NOT_FOUND'; end if;
  if a.status <> 'ACTIVE' then raise exception 'QB_APPROVAL_NOT_ACTIVE'; end if;
  if length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'QB_APPROVAL_NOTE_REQUIRED'; end if;
  update public.questions q set validation_status = 'review', status = 'inactive', reviewed_by = null, reviewed_at = null,
         editorial_metadata = (coalesce(q.editorial_metadata, '{}'::jsonb) - 'human_reviewed' - 'approval_basis' - 'approval_id' - 'review_note') || jsonb_build_object('owner_approval_revoked', a.id)
   where q.editorial_metadata ->> 'approval_id' = a.id::text and q.validation_status = 'approved';
  get diagnostics n = row_count;
  update public.question_batch_approvals set status = 'REVOKED', revoked_at = now(), revoked_by = auth.uid(), revoke_note = btrim(p_note) where id = a.id;
  return jsonb_build_object('approval_id', a.id, 'returned_to_review', n);
end $fn$;

revoke all on function public.qb_owner_batch_preview(uuid), public.qb_owner_approve_batch(uuid, text, integer, boolean), public.qb_owner_revoke_batch_approval(uuid, text) from public, anon;
grant execute on function public.qb_owner_batch_preview(uuid), public.qb_owner_approve_batch(uuid, text, integer, boolean), public.qb_owner_revoke_batch_approval(uuid, text) to authenticated;

commit;

-- ============ 2. Free allowance and subscriptions (standalone) ============
-- Free allowance and subscriptions, standalone. Replaces the dependency of 20261014100000 on quizbox_core and access_entitlements, which the
-- production database does not have. Self-contained: own settings table, own subscription table, admin functions and the gated quick-practice
-- builder. Safe whether or not 20261014100000 was applied. The gate stays OFF until free_practice_sessions is set.
--   qb_admin_set_free_allowance(n | null)                  super admin; null switches the gate off
--   qb_admin_grant_subscription(user, days, plan, note)     super admin; manual grant until payments are live (payments will write the same table)
--   qb_admin_revoke_subscription(id, note)                  super admin
--   qb_my_access()                                          the signed-in user's allowance (same shape the app already reads)
begin;

create table if not exists public.qb_access_settings (
  key text primary key check (key ~ '^[a-z0-9_.]+$'),
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.qb_access_settings enable row level security;
revoke all on public.qb_access_settings from public, anon, authenticated;

create table if not exists public.learner_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan text not null check (length(btrim(plan)) between 2 and 60),
  status text not null default 'active' check (status in ('active', 'revoked')),
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  source text not null default 'manual' check (source in ('manual', 'payment')),
  source_ref text,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz, revoked_by uuid references public.profiles(id),
  check (valid_until > valid_from)
);
create index if not exists learner_subscriptions_user on public.learner_subscriptions(user_id, status, valid_until);
create unique index if not exists learner_subscriptions_source_ref on public.learner_subscriptions(source, source_ref) where source_ref is not null;
alter table public.learner_subscriptions enable row level security;
revoke all on public.learner_subscriptions from public, anon, authenticated;
grant select on public.learner_subscriptions to authenticated;
drop policy if exists learner_subscriptions_own on public.learner_subscriptions;
create policy learner_subscriptions_own on public.learner_subscriptions for select to authenticated using (user_id = auth.uid());

create or replace function public.qb_access_free_limit() returns integer
language sql stable security definer set search_path = '' as $fn$
  select case when jsonb_typeof(value) = 'number' and (value #>> '{}')::numeric >= 0 then (value #>> '{}')::numeric::integer end
    from public.qb_access_settings where key = 'free_practice_sessions'
$fn$;

create or replace function public.qb_has_subscription(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.learner_subscriptions s where s.user_id = p_user and s.status = 'active' and s.valid_from <= now() and s.valid_until > now())
$fn$;

create or replace function public.qb_free_allowance_exhausted(p_user uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $fn$
declare lim integer := public.qb_access_free_limit();
begin
  if lim is null or public.qb_has_subscription(p_user) then return false; end if;
  return (select count(*) from public.assessments a where a.owner_user_id = p_user and a.reference_type = 'SELF_PRACTICE') >= lim;
end $fn$;

create or replace function public.qb_my_access() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare lim integer := public.qb_access_free_limit(); used integer; learner boolean; sub boolean;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select exists (select 1 from public.student_profiles where user_id = auth.uid()) into learner;
  sub := public.qb_has_subscription(auth.uid());
  select count(*)::integer into used from public.assessments a where a.owner_user_id = auth.uid() and a.reference_type = 'SELF_PRACTICE';
  return jsonb_build_object('gated', learner and lim is not null, 'free_limit', lim, 'used', used,
    'remaining', case when lim is null then null else greatest(lim - used, 0) end, 'subscribed', sub,
    'exhausted', learner and public.qb_free_allowance_exhausted(auth.uid()),
    'subscription_until', (select max(valid_until) from public.learner_subscriptions s where s.user_id = auth.uid() and s.status = 'active' and s.valid_until > now()));
end $fn$;

create or replace function public.qb_admin_set_free_allowance(p_sessions integer) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if p_sessions is null then delete from public.qb_access_settings where key = 'free_practice_sessions'; return jsonb_build_object('free_practice_sessions', null, 'gate', 'off'); end if;
  if p_sessions not between 0 and 10000 then raise exception 'QB_INVALID_ALLOWANCE'; end if;
  insert into public.qb_access_settings(key, value, updated_by) values ('free_practice_sessions', to_jsonb(p_sessions), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('free_practice_sessions', p_sessions, 'gate', 'on');
end $fn$;

create or replace function public.qb_admin_grant_subscription(p_user uuid, p_days integer, p_plan text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare s public.learner_subscriptions; base timestamptz;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'QB_USER_NOT_FOUND'; end if;
  if p_days is null or p_days not between 1 and 731 then raise exception 'QB_INVALID_SUBSCRIPTION_DAYS'; end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'QB_SUBSCRIPTION_NOTE_REQUIRED'; end if;
  -- An extension starts when the current subscription ends, so paid days are never lost.
  select greatest(now(), coalesce(max(valid_until), now())) into base from public.learner_subscriptions where user_id = p_user and status = 'active';
  insert into public.learner_subscriptions(user_id, plan, valid_from, valid_until, source, note, created_by)
  values (p_user, btrim(coalesce(nullif(p_plan, ''), 'learner')), base, base + make_interval(days => p_days), 'manual', btrim(p_note), auth.uid()) returning * into s;
  return to_jsonb(s);
end $fn$;

create or replace function public.qb_admin_revoke_subscription(p_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare s public.learner_subscriptions;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'QB_SUBSCRIPTION_NOTE_REQUIRED'; end if;
  update public.learner_subscriptions set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(), note = coalesce(note, '') || ' | revoked: ' || btrim(p_note)
   where id = p_id and status = 'active' returning * into s;
  if s.id is null then raise exception 'QB_SUBSCRIPTION_NOT_FOUND'; end if;
  return to_jsonb(s);
end $fn$;

create or replace function public.qb_admin_access_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'free_limit', public.qb_access_free_limit(),
    'learners', (select count(*) from public.student_profiles),
    'subscribed_now', (select count(distinct user_id) from public.learner_subscriptions s where s.status = 'active' and s.valid_from <= now() and s.valid_until > now()),
    'subscriptions', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
        select jsonb_build_object('id', s.id, 'email', p.email, 'name', p.full_name, 'plan', s.plan, 'status', s.status, 'source', s.source,
               'valid_from', s.valid_from, 'valid_until', s.valid_until, 'note', s.note, 'created_at', s.created_at) as x
          from public.learner_subscriptions s join public.profiles p on p.id = s.user_id order by s.created_at desc limit 100) y), '[]'::jsonb));
end $fn$;

create or replace function public.qb_admin_grant_subscription_email(p_email text, p_days integer, p_plan text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare u uuid;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  select id into u from public.profiles where lower(email) = lower(btrim(coalesce(p_email, '')));
  if u is null then raise exception 'QB_USER_NOT_FOUND'; end if;
  return public.qb_admin_grant_subscription(u, p_days, p_plan, p_note);
end $fn$;

create or replace function public.qb_start_quick_practice(p_topic_ids uuid[], p_count integer default 10, p_grade text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare sp public.student_profiles; g text; m uuid; r text; subj public.curriculum_nodes; v_assessment public.assessments; v_available integer; v_used integer;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if p_topic_ids is null or cardinality(p_topic_ids) not between 1 and 40 then raise exception 'QB_PRACTICE_TOPICS_REQUIRED'; end if;
  if p_count is null or p_count not between 3 and 30 then raise exception 'QB_PRACTICE_COUNT_INVALID'; end if;
  select * into sp from public.student_profiles where user_id = auth.uid();
  select default_market_id, upper(role::text) into m, r from public.profiles where id = auth.uid();
  -- A learner who has used the free allowance and has no active subscription is sent to subscribe (the app redirects on this code).
  if sp.id is not null and public.qb_free_allowance_exhausted(auth.uid()) then raise exception 'QB_FREE_ALLOWANCE_EXHAUSTED'; end if;
  if sp.id is not null then
    g := upper(coalesce(nullif(sp.grade_code, ''), sp.grade::text));
  elsif r in ('TEACHER', 'ADMIN', 'OWNER') then
    g := upper(nullif(btrim(coalesce(p_grade, '')), ''));
    if g is null then raise exception 'QB_PRACTICE_GRADE_REQUIRED'; end if;
  else
    raise exception 'QB_STUDENT_REQUIRED' using errcode = '42501';
  end if;

  create temporary table qb_quick_pool on commit drop as
  with recursive down(id, subject_id, topic_id, node_type, depth) as (
    select n.id, n.id, null::uuid, n.node_type, 0
      from public.curriculum_nodes n join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
     where n.is_active and n.node_type = 'subject' and upper(coalesce(n.canonical_grade_code, n.grade_code)) = g and (m is null or mc.market_id = m)
    union all
    select c.id, d.subject_id, case when c.node_type = 'sub_strand' then c.id else d.topic_id end, c.node_type, d.depth + 1
      from down d join public.curriculum_nodes c on c.parent_id = d.id where c.is_active and d.depth < 8)
  select q.id as question_id, q.version, d.subject_id, d.topic_id,
         row_number() over (partition by d.topic_id order by random()) as rn
    from down d join public.questions q on q.curriculum_node_id = d.id
   where d.node_type = 'learning_indicator' and d.topic_id = any (p_topic_ids)
     and q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated') and public.qb_question_is_available(q)
     and coalesce(q.source_type, '') not like 'DEV\_%';

  -- Every ticked topic must be one this learner is allowed to practise, and all must belong to one subject.
  if (select count(distinct topic_id) from qb_quick_pool) = 0 then raise exception 'QB_PRACTICE_NO_QUESTIONS'; end if;
  if (select count(distinct subject_id) from qb_quick_pool) <> 1 then raise exception 'QB_PRACTICE_ONE_SUBJECT'; end if;
  select s.* into subj from public.curriculum_nodes s where s.id = (select subject_id from qb_quick_pool limit 1);

  create temporary table qb_quick_pick on commit drop as
  select question_id from qb_quick_pool order by rn, random() limit p_count;
  select count(*) into v_used from qb_quick_pick;

  insert into public.assessments(assessment_type, owner_role, owner_user_id, subject_code, subject_name, grade, grade_code, question_count, difficulty,
                                 time_limit_minutes, max_attempts, allow_resume, auto_submit, pass_percent, expires_at, instructions, tenant_id, reference_type)
  values ('PRACTICE', (case when sp.id is not null then 'student' when r = 'TEACHER' then 'teacher' else 'admin' end)::public.qb_role, auth.uid(), coalesce(subj.subject_code, subj.title), subj.title,
          case when exists (select 1 from pg_catalog.pg_enum e where e.enumtypid = 'public.qb_grade'::regtype and e.enumlabel = g) then g::public.qb_grade else null end,
          g, v_used, 'mixed', greatest(5, v_used * 2), 1, true, true, 40, now() + interval '3 days',
          'Your own practice set.', public.qb_public_tenant_id(), 'SELF_PRACTICE')
  returning * into v_assessment;

  insert into public.assessment_questions(assessment_id, question_id, question_order, question_text_snapshot, option_a_snapshot, option_b_snapshot, option_c_snapshot,
                                          option_d_snapshot, correct_answer_snapshot, marks_snapshot, question_content_snapshot, answer_type_snapshot, answer_spec_snapshot)
  select v_assessment.id, q.id, row_number() over (order by random()), q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, q.marks,
         q.question_content, q.answer_type, q.answer_spec
    from qb_quick_pick p join public.questions q on q.id = p.question_id;

  return jsonb_build_object('assessment_id', v_assessment.id, 'subject', subj.title, 'question_count', v_used, 'requested', p_count, 'short', v_used < p_count);
end $fn$;

revoke all on function public.qb_access_free_limit(), public.qb_has_subscription(uuid), public.qb_free_allowance_exhausted(uuid) from public, anon, authenticated;
revoke all on function public.qb_my_access(), public.qb_admin_set_free_allowance(integer), public.qb_admin_grant_subscription(uuid, integer, text, text),
  public.qb_admin_revoke_subscription(uuid, text), public.qb_admin_access_overview(), public.qb_admin_grant_subscription_email(text, integer, text, text) from public, anon;
grant execute on function public.qb_my_access(), public.qb_admin_set_free_allowance(integer), public.qb_admin_grant_subscription(uuid, integer, text, text),
  public.qb_admin_revoke_subscription(uuid, text), public.qb_admin_access_overview(), public.qb_admin_grant_subscription_email(text, integer, text, text) to authenticated;
revoke all on function public.qb_start_quick_practice(uuid[], integer, text) from public, anon;
grant execute on function public.qb_start_quick_practice(uuid[], integer, text) to authenticated;

commit;

-- ============ 3. Readable topic names ============
-- Readable topic names in the practice builder. Some curriculum loads stored a code ("B9.1.1") or a placeholder ("Sub-strand") as a node title.
-- A learner must never see a code, so such a topic is shown by the wording of its first learning indicator instead, and a code-like strand
-- name is hidden. Data is untouched; only the menu label changes. Replaces qb_practice_menu from 20261012210000 with the same output shape.
begin;

create or replace function public.qb_label_is_code(p text) returns boolean
language sql immutable set search_path = '' as $fn$
  select p is null or btrim(p) = '' or btrim(p) ~* '^(strand|sub-?strand|topic|unit)?\s*[a-z]{0,4}\s*[0-9]+([.:][0-9]+)*\.?$'
      or btrim(p) ~* '^(strand|sub-?strand|topic|unit|content standard|indicator)$'
$fn$;

create or replace function public.qb_topic_label(p_topic uuid) returns text
language sql stable security definer set search_path = '' as $fn$
  with t as (select title from public.curriculum_nodes where id = p_topic),
  first_indicator as (
    select n.title from public.curriculum_nodes n
      left join public.curriculum_nodes cs on cs.id = n.parent_id
     where n.node_type = 'learning_indicator' and n.is_active and (n.parent_id = p_topic or cs.parent_id = p_topic)
     order by coalesce(cs.sort_order, 0), n.sort_order, n.title limit 1)
  select case when public.qb_label_is_code((select title from t))
              then coalesce(nullif(left(regexp_replace((select title from first_indicator), '\s+', ' ', 'g'), 90), ''), (select title from t))
              else (select title from t) end
$fn$;

create or replace function public.qb_practice_menu(p_grade text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare sp public.student_profiles; g text; m uuid; r text;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into sp from public.student_profiles where user_id = auth.uid();
  select default_market_id, upper(role::text) into m, r from public.profiles where id = auth.uid();
  if sp.id is not null then
    g := upper(coalesce(nullif(sp.grade_code, ''), sp.grade::text));
  elsif r in ('TEACHER', 'ADMIN', 'OWNER') then
    -- Staff use the same builder; they choose the grade they are working on.
    g := upper(nullif(btrim(coalesce(p_grade, '')), ''));
    if g is null then
      return jsonb_build_object('grade', null, 'subjects', '[]'::jsonb, 'grades', coalesce((
        select jsonb_agg(x order by x) from (select distinct upper(coalesce(n.canonical_grade_code, n.grade_code)) as x
          from public.curriculum_nodes n join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
         where n.is_active and n.node_type = 'subject' and coalesce(n.canonical_grade_code, n.grade_code) is not null and (m is null or mc.market_id = m)) y), '[]'::jsonb));
    end if;
  else
    raise exception 'QB_STUDENT_REQUIRED' using errcode = '42501';
  end if;
  return jsonb_build_object('grade', g, 'subjects', coalesce((
    with recursive down(id, subject_id, topic_id, node_type, depth) as (
      select n.id, n.id, null::uuid, n.node_type, 0
        from public.curriculum_nodes n join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
       where n.is_active and n.node_type = 'subject' and upper(coalesce(n.canonical_grade_code, n.grade_code)) = g and (m is null or mc.market_id = m)
      union all
      select c.id, d.subject_id, case when c.node_type = 'sub_strand' then c.id else d.topic_id end, c.node_type, d.depth + 1
        from down d join public.curriculum_nodes c on c.parent_id = d.id where c.is_active and d.depth < 8),
    avail as (
      select d.subject_id, d.topic_id, count(q.id)::integer as n
        from down d join public.questions q on q.curriculum_node_id = d.id
       where d.node_type = 'learning_indicator' and d.topic_id is not null
         and q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated') and public.qb_question_is_available(q)
         and coalesce(q.source_type, '') not like 'DEV\_%'
       group by d.subject_id, d.topic_id),
    subj as (
      select s.id, s.title, s.subject_code, sum(a.n)::integer as total,
             jsonb_agg(jsonb_build_object('id', t.id, 'title', public.qb_topic_label(t.id), 'strand', case when public.qb_label_is_code(st.title) then '' else coalesce(st.title, '') end, 'available', a.n) order by st.sort_order, t.sort_order, t.title) as topics
        from avail a join public.curriculum_nodes s on s.id = a.subject_id
        join public.curriculum_nodes t on t.id = a.topic_id left join public.curriculum_nodes st on st.id = t.parent_id and st.node_type = 'strand'
       group by s.id, s.title, s.subject_code)
    select jsonb_agg(jsonb_build_object('id', id, 'name', title, 'subject_code', subject_code, 'available', total, 'topics', topics) order by title) from subj), '[]'::jsonb));
end $fn$;

revoke all on function public.qb_topic_label(uuid) from public, anon;
grant execute on function public.qb_topic_label(uuid), public.qb_label_is_code(text) to authenticated;
revoke all on function public.qb_practice_menu(text) from public, anon;
grant execute on function public.qb_practice_menu(text) to authenticated;

commit;

-- ============ 4. Grant hardening (TRUNCATE etc. removed from browser roles) ============
-- Grant hardening, part 1 (tracker C6; completion plan Phase 3 step 2).
-- Supabase gives the client roles every table privilege by default. Browsers never need to TRUNCATE a table, create foreign keys to it
-- (REFERENCES) or attach triggers (TRIGGER), so those three are removed from anon and authenticated on every table in the application schemas.
-- SELECT, INSERT, UPDATE and DELETE are untouched (row-level security governs them), so no screen changes behaviour.
-- Default privileges are tightened too, so tables created later do not get these rights back.
-- Part 2 (narrowing anon's SELECT and write grants) needs the production grant list first; it is not in this migration.
begin;

do $hard$
declare s text; t record;
begin
  for t in
    select n.nspname as schema_name, c.relname as table_name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p', 'v', 'm', 'f')
       and (n.nspname = 'public' or n.nspname like 'quizbox\_%')
  loop
    execute format('revoke truncate, references, trigger on table %I.%I from anon, authenticated', t.schema_name, t.table_name);
  end loop;
  for s in select nspname from pg_namespace where nspname = 'public' or nspname like 'quizbox\_%' loop
    execute format('alter default privileges in schema %I revoke truncate, references, trigger on tables from anon, authenticated', s);
  end loop;
end $hard$;

commit;

-- ============ 5. Teacher and admin practice preview ============
-- Staff practice preview. Attempts are for learners (qb_start_attempt requires a student profile), so a teacher or admin who builds a practice set
-- with the quick builder could not open it. This read-only function returns the set's questions WITH answers and explanations, only to the staff
-- member who built it, so they can check content or teach from it. It records nothing and never touches learner attempts or scores.
begin;

create or replace function public.qb_staff_practice_preview(p_assessment uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare a public.assessments; r text;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select upper(role::text) into r from public.profiles where id = auth.uid();
  if r is null or r not in ('TEACHER', 'ADMIN', 'OWNER') then raise exception 'QB_STAFF_REQUIRED' using errcode = '42501'; end if;
  select * into a from public.assessments where id = p_assessment;
  if a.id is null or a.owner_user_id is distinct from auth.uid() then raise exception 'QB_ASSESSMENT_NOT_FOUND'; end if;
  return jsonb_build_object('assessment_id', a.id, 'subject', a.subject_name, 'grade', a.grade_code, 'question_count', a.question_count,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('n', aq.question_order, 'question', aq.question_text_snapshot,
        'a', aq.option_a_snapshot, 'b', aq.option_b_snapshot, 'c', aq.option_c_snapshot, 'd', aq.option_d_snapshot,
        'correct', aq.correct_answer_snapshot, 'answer_type', aq.answer_type_snapshot, 'content', aq.question_content_snapshot,
        'explanation', q.explanation) order by aq.question_order)
      from public.assessment_questions aq left join public.questions q on q.id = aq.question_id where aq.assessment_id = a.id), '[]'::jsonb));
end $fn$;

revoke all on function public.qb_staff_practice_preview(uuid) from public, anon;
grant execute on function public.qb_staff_practice_preview(uuid) to authenticated;

commit;

