-- APPLY: topic study mode, then teacher-managed learners (under 13). Each is its own transaction and safe to run twice.

-- ============ 1. Topic study mode: 20261019140000_study_mode.sql ============
-- Topic study mode (tracker T4). A learner picks ONE topic and works through its questions in learning order (easy, then medium, then hard), seeing
-- the explanation after every answer (the existing practice feedback already returns it). Questions the learner has not seen come first, then ones they
-- got wrong, then ones they got right, so repeated sessions keep moving through the topic instead of repeating it.
--   qb_topic_progress(topic_ids)                    per topic: how many approved questions exist, how many the learner has answered, how many correctly
--   qb_start_study_session(topic, count, grade)     builds the ordered set; the same grade, market and free-allowance rules as the quick builder
-- A "topic" here is what the practice builder lists (a sub-strand). Study sessions count as self-built practice for the free allowance.
begin;

create or replace function public.qb_topic_progress(p_topic_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if p_topic_ids is null or cardinality(p_topic_ids) > 80 then raise exception 'QB_PRACTICE_TOPICS_REQUIRED'; end if;
  return coalesce((
    with recursive down(id, topic_id, node_type, depth) as (
      select n.id, n.id, n.node_type, 0 from public.curriculum_nodes n where n.id = any (p_topic_ids) and n.is_active and n.node_type = 'sub_strand'
      union all
      select c.id, d.topic_id, c.node_type, d.depth + 1 from down d join public.curriculum_nodes c on c.parent_id = d.id where c.is_active and d.depth < 6),
    qs as (
      select d.topic_id, q.id as question_id from down d join public.questions q on q.curriculum_node_id = d.id
       where d.node_type = 'learning_indicator' and q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated')
         and public.qb_question_is_available(q) and coalesce(q.source_type, '') not like 'DEV\_%'),
    mine as (
      select r.question_id, bool_or(coalesce(r.is_correct, false)) as ever_correct
        from public.responses r join public.attempts a on a.id = r.attempt_id where a.student_user_id = auth.uid() group by r.question_id)
    select jsonb_agg(jsonb_build_object('topic_id', t.topic_id, 'total', t.total, 'answered', t.answered, 'correct', t.correct) order by t.topic_id)
      from (select qs.topic_id, count(*)::integer as total, count(mine.question_id)::integer as answered, count(*) filter (where mine.ever_correct)::integer as correct
              from qs left join mine on mine.question_id = qs.question_id group by qs.topic_id) t), '[]'::jsonb);
end $fn$;

create or replace function public.qb_start_study_session(p_topic uuid, p_count integer default 12, p_grade text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare sp public.student_profiles; g text; m uuid; r text; subj public.curriculum_nodes; v_assessment public.assessments; v_used integer; v_new integer;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if p_topic is null then raise exception 'QB_PRACTICE_TOPICS_REQUIRED'; end if;
  if p_count is null or p_count not between 3 and 30 then raise exception 'QB_PRACTICE_COUNT_INVALID'; end if;
  select * into sp from public.student_profiles where user_id = auth.uid();
  select default_market_id, upper(role::text) into m, r from public.profiles where id = auth.uid();
  if sp.id is not null and public.qb_free_allowance_exhausted(auth.uid()) then raise exception 'QB_FREE_ALLOWANCE_EXHAUSTED'; end if;
  if sp.id is not null then
    g := upper(coalesce(nullif(sp.grade_code, ''), sp.grade::text));
  elsif r in ('TEACHER', 'ADMIN', 'OWNER') then
    g := upper(nullif(btrim(coalesce(p_grade, '')), ''));
    if g is null then raise exception 'QB_PRACTICE_GRADE_REQUIRED'; end if;
  else
    raise exception 'QB_STUDENT_REQUIRED' using errcode = '42501';
  end if;

  create temporary table qb_study_pool on commit drop as
  with recursive down(id, subject_id, in_topic, node_type, depth) as (
    select n.id, n.id, false, n.node_type, 0
      from public.curriculum_nodes n join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
     where n.is_active and n.node_type = 'subject' and upper(coalesce(n.canonical_grade_code, n.grade_code)) = g and (m is null or mc.market_id = m)
    union all
    select c.id, d.subject_id, d.in_topic or (c.id = p_topic and c.node_type = 'sub_strand'), c.node_type, d.depth + 1
      from down d join public.curriculum_nodes c on c.parent_id = d.id where c.is_active and d.depth < 8)
  select q.id as question_id, q.version, d.subject_id,
         case lower(coalesce(q.difficulty_label, '')) when 'easy' then 1 when 'medium' then 2 when 'hard' then 3 else 2 end as diff_rank,
         case when exists (select 1 from public.responses rr join public.attempts aa on aa.id = rr.attempt_id where aa.student_user_id = auth.uid() and rr.question_id = q.id and coalesce(rr.is_correct, false)) then 2
              when exists (select 1 from public.responses rr join public.attempts aa on aa.id = rr.attempt_id where aa.student_user_id = auth.uid() and rr.question_id = q.id) then 1
              else 0 end as seen_rank
    from down d join public.questions q on q.curriculum_node_id = d.id
   where d.node_type = 'learning_indicator' and d.in_topic
     and q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated') and public.qb_question_is_available(q)
     and coalesce(q.source_type, '') not like 'DEV\_%';

  if (select count(*) from qb_study_pool) = 0 then raise exception 'QB_PRACTICE_NO_QUESTIONS'; end if;
  select s.* into subj from public.curriculum_nodes s where s.id = (select subject_id from qb_study_pool limit 1);

  -- Unseen first, then the ones the learner got wrong, then the ones they got right; spread across difficulty so one session still climbs from easy to hard.
  create temporary table qb_study_pick on commit drop as
  select question_id, diff_rank, seen_rank from qb_study_pool order by seen_rank, random() limit p_count;
  select count(*), count(*) filter (where seen_rank = 0) into v_used, v_new from qb_study_pick;

  insert into public.assessments(assessment_type, owner_role, owner_user_id, subject_code, subject_name, grade, grade_code, question_count, difficulty,
                                 time_limit_minutes, max_attempts, allow_resume, auto_submit, pass_percent, expires_at, instructions, tenant_id, reference_type)
  values ('PRACTICE', (case when sp.id is not null then 'student' when r = 'TEACHER' then 'teacher' else 'admin' end)::public.qb_role, auth.uid(), coalesce(subj.subject_code, subj.title), subj.title,
          case when exists (select 1 from pg_catalog.pg_enum e where e.enumtypid = 'public.qb_grade'::regtype and e.enumlabel = g) then g::public.qb_grade else null end,
          g, v_used, 'mixed', greatest(10, v_used * 3), 1, true, true, 40, now() + interval '3 days',
          'Study session: questions go from easier to harder. Read the explanation after each answer.', public.qb_public_tenant_id(), 'SELF_PRACTICE')
  returning * into v_assessment;

  insert into public.assessment_questions(assessment_id, question_id, question_order, question_text_snapshot, option_a_snapshot, option_b_snapshot, option_c_snapshot,
                                          option_d_snapshot, correct_answer_snapshot, marks_snapshot, question_content_snapshot, answer_type_snapshot, answer_spec_snapshot)
  select v_assessment.id, q.id, row_number() over (order by p.diff_rank, random()), q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, q.marks,
         q.question_content, q.answer_type, q.answer_spec
    from qb_study_pick p join public.questions q on q.id = p.question_id;

  return jsonb_build_object('assessment_id', v_assessment.id, 'subject', subj.title, 'question_count', v_used, 'requested', p_count, 'short', v_used < p_count, 'new_questions', v_new);
end $fn$;

revoke all on function public.qb_topic_progress(uuid[]), public.qb_start_study_session(uuid, integer, text) from public, anon;
grant execute on function public.qb_topic_progress(uuid[]), public.qb_start_study_session(uuid, integer, text) to authenticated;

commit;

-- ============ 2. Teacher-managed learners: 20261019150000_managed_learners.sql ============
-- Teacher-managed learner accounts for children under 13 (tracker G8; owner decisions recorded in docs/security/UNDER_13_DESIGN.md).
-- Young children do not register themselves. A teacher creates accounts for the learners of a class they own: first name only, no email, no phone,
-- a generated username and password. The teacher must confirm that the school holds the guardian's consent, and that confirmation is stored.
-- Managed learners are blocked from public features (chat, public leaderboards with real names, sponsored prizes, paid challenges, discoverability).
-- The server route that creates the sign-in uses the service role; every database function below checks the teacher itself.
--   qb_managed_class_context(class)                   teacher: the class's grade, school and market (proves they own it)
--   qb_managed_learner_provision(...)                 service role only: builds the profile, class seat and consent record for a new sign-in
--   qb_managed_learner_list(class)                    teacher: the managed learners of a class (username, first name, status)
--   qb_managed_learner_authorise(teacher, learner)    service role only: may this teacher reset or archive this learner?
--   qb_managed_learner_archive(learner)               teacher: ends the account (inactive, removed from the class); data is kept for the school's retention period
--   qb_consume_budget(key, limit, seconds)            service role only: durable hourly limits for the route
--   qb_feature_allowed(feature)                       replaced: also blocks the managed-minor features
begin;

alter table public.student_profiles add column if not exists managed_by uuid references public.profiles(id);
alter table public.student_profiles add column if not exists is_minor boolean not null default false;
alter table public.student_profiles add column if not exists archived_at timestamptz;
create index if not exists student_profiles_managed_by on public.student_profiles(managed_by) where managed_by is not null;

insert into public.platform_settings(key, scope_type, value, description)
select 'safety.managed_minor_blocked_features', 'global', '["chat","public_leaderboards","public_discoverability","sponsored_prizes","paid_challenges"]'::jsonb,
       'Features never available to teacher-managed learners under 13'
 where not exists (select 1 from public.platform_settings where key = 'safety.managed_minor_blocked_features' and scope_type = 'global');

create or replace function public.qb_managed_class_context(p_class uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare c public.classes;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into c from public.classes where id = p_class;
  if c.id is null or lower(c.status::text) <> 'active' or not (c.teacher_user_id = auth.uid() or public.qb_is_platform_admin()) then raise exception 'QB_CLASS_NOT_MANAGED' using errcode = '42501'; end if;
  return jsonb_build_object('class_id', c.id, 'class_name', c.class_name, 'grade', c.grade::text, 'grade_label', c.grade_label, 'school', c.school_name);
end $fn$;

create or replace function public.qb_managed_learner_provision(p_teacher uuid, p_class uuid, p_user uuid, p_first_name text, p_username text, p_consent_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare c public.classes; t public.profiles; first text := btrim(coalesce(p_first_name, '')); sp public.student_profiles; grade_code text; mkt uuid; country text;
begin
  select * into c from public.classes where id = p_class;
  select * into t from public.profiles where id = p_teacher;
  if c.id is null or t.id is null or lower(c.status::text) <> 'active' or c.teacher_user_id <> p_teacher then raise exception 'QB_CLASS_NOT_MANAGED' using errcode = '42501'; end if;
  if char_length(first) not between 2 and 40 or first !~ '^[A-Za-z][A-Za-z '' -]*$' then raise exception 'QB_MANAGED_NAME_INVALID'; end if;
  if p_username !~ '^[a-z][a-z0-9.]{3,30}$' then raise exception 'QB_MANAGED_USERNAME_INVALID'; end if;
  if char_length(btrim(coalesce(p_consent_ref, ''))) < 5 then raise exception 'QB_MANAGED_CONSENT_REQUIRED'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'AUTH_REQUIRED'; end if;
  grade_code := c.grade::text; mkt := coalesce(t.primary_market_id, t.default_market_id); country := t.country;
  -- the sign-in trigger may already have made a basic profile; make it the managed learner's profile
  insert into public.profiles(id, role, full_name, email, status, country, school_name, default_market_id, primary_market_id, onboarding_completed_at)
  values (p_user, 'student', first, (select email from auth.users where id = p_user), 'active', coalesce(country, 'Ghana'), c.school_name, mkt, mkt, now())
  on conflict (id) do update set role = 'student', full_name = excluded.full_name, status = 'active', country = excluded.country, school_name = excluded.school_name,
      default_market_id = excluded.default_market_id, primary_market_id = excluded.primary_market_id, onboarding_completed_at = excluded.onboarding_completed_at;
  insert into public.student_profiles(user_id, grade, school_name, country, status, managed_by, is_minor)
  values (p_user, c.grade, c.school_name, coalesce(country, 'Ghana'), 'active', p_teacher, true)
  on conflict (user_id) do update set grade = excluded.grade, school_name = excluded.school_name, status = 'active', managed_by = excluded.managed_by, is_minor = true, archived_at = null
  returning * into sp;
  if mkt is not null then insert into public.user_market_memberships(user_id, market_id, active) values (p_user, mkt, true) on conflict (user_id, market_id) do update set active = true; end if;
  insert into public.class_memberships(class_id, student_id, student_user_id, student_email, student_name, grade, status, approved_at)
  values (c.id, sp.id, p_user, p_username, first, c.grade, 'active', now())
  on conflict do nothing;
  insert into public.learner_consent(user_id, status, policy_ref, decided_by, decided_at)
  values (p_user, 'granted', 'school-attested: ' || left(btrim(p_consent_ref), 120), p_teacher, now())
  on conflict (user_id) do update set status = 'granted', policy_ref = excluded.policy_ref, decided_by = excluded.decided_by, decided_at = excluded.decided_at, updated_at = now();
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details)
  values (p_teacher, 'QB_MANAGED_LEARNER_CREATED', 'profiles', p_user, 'pass', jsonb_build_object('class', c.id, 'username', p_username));
  return jsonb_build_object('user_id', p_user, 'student_id', sp.id, 'class_id', c.id, 'username', p_username, 'first_name', first);
end $fn$;

create or replace function public.qb_managed_learner_list(p_class uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.classes c where c.id = p_class and (c.teacher_user_id = auth.uid() or public.qb_is_platform_admin())) then raise exception 'QB_CLASS_NOT_MANAGED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', sp.user_id, 'first_name', p.full_name, 'username', split_part(p.email, '@', 1), 'status', sp.status::text, 'created_at', sp.created_at,
      'archived_at', sp.archived_at) order by p.full_name)
    from public.class_memberships m join public.student_profiles sp on sp.user_id = m.student_user_id join public.profiles p on p.id = sp.user_id
   where m.class_id = p_class and sp.managed_by is not null), '[]'::jsonb);
end $fn$;

create or replace function public.qb_managed_learner_authorise(p_teacher uuid, p_learner uuid) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.student_profiles sp where sp.user_id = p_learner and sp.managed_by is not null and sp.is_minor
                   and (sp.managed_by = p_teacher or exists (select 1 from public.class_memberships m join public.classes c on c.id = m.class_id where m.student_user_id = p_learner and c.teacher_user_id = p_teacher)))
$fn$;

create or replace function public.qb_managed_learner_archive(p_learner uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not public.qb_managed_learner_authorise(auth.uid(), p_learner) then raise exception 'QB_MANAGED_LEARNER_NOT_FOUND' using errcode = '42501'; end if;
  update public.student_profiles set status = 'inactive', archived_at = now() where user_id = p_learner;
  update public.class_memberships set status = 'inactive' where student_user_id = p_learner;
  update public.profiles set status = 'inactive' where id = p_learner;
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (auth.uid(), 'QB_MANAGED_LEARNER_ARCHIVED', 'profiles', p_learner, 'pass', '{}'::jsonb);
  return jsonb_build_object('archived', true);
end $fn$;

create or replace function public.qb_consume_budget(p_key text, p_limit integer, p_seconds integer) returns boolean
language sql security definer set search_path = '' as $fn$ select quizbox_private.consume_intake_budget(left(p_key, 120), p_limit, p_seconds) $fn$;

-- Managed learners are blocked from public features whatever their consent status; everything else keeps the original consent rule.
create or replace function public.qb_feature_allowed(p_feature text) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select not (coalesce((select status from public.learner_consent where user_id = auth.uid()), 'not_required') in ('pending', 'withdrawn')
              and coalesce(quizbox_core.setting('safety.consent_pending_blocked_features'), '[]'::jsonb) ? p_feature)
     and not (exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid() and sp.is_minor)
              and coalesce(quizbox_core.setting('safety.managed_minor_blocked_features'), '[]'::jsonb) ? p_feature);
$fn$;

revoke all on function public.qb_managed_class_context(uuid), public.qb_managed_learner_list(uuid), public.qb_managed_learner_archive(uuid) from public, anon;
grant execute on function public.qb_managed_class_context(uuid), public.qb_managed_learner_list(uuid), public.qb_managed_learner_archive(uuid) to authenticated;
revoke all on function public.qb_managed_learner_provision(uuid, uuid, uuid, text, text, text), public.qb_managed_learner_authorise(uuid, uuid), public.qb_consume_budget(text, integer, integer) from public, anon, authenticated;
grant execute on function public.qb_managed_learner_provision(uuid, uuid, uuid, text, text, text), public.qb_managed_learner_authorise(uuid, uuid), public.qb_consume_budget(text, integer, integer) to service_role;
revoke all on function public.qb_feature_allowed(text) from public, anon;
grant execute on function public.qb_feature_allowed(text) to authenticated;

commit;

