-- Free allowance and subscription gate for self-built practice.
-- The free allowance is a platform setting (key access.free_practice_sessions, a number of practice sessions per learner). While the setting is
-- absent the gate is OFF, so nothing changes until the owner sets a number. A learner is subscribed when they hold an active access_entitlement of
-- kind 'subscription' (valid_until empty or in the future). Only sessions built by qb_start_quick_practice count (reference_type SELF_PRACTICE).
-- Teachers, admins and owners are never gated. Rollback restores 20261012210000 behaviour.
begin;

create or replace function public.qb_free_allowance_exhausted(p_user uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $fn$
declare lim numeric;
begin
  begin lim := (quizbox_core.setting('access.free_practice_sessions') #>> '{}')::numeric; exception when others then lim := null; end;
  if lim is null or lim < 0 then return false; end if;
  if exists (select 1 from public.access_entitlements e where e.user_id = p_user and e.kind = 'subscription' and e.status = 'active'
                and e.valid_from <= now() and (e.valid_until is null or e.valid_until > now())) then return false; end if;
  return (select count(*) from public.assessments a where a.owner_user_id = p_user and a.reference_type = 'SELF_PRACTICE') >= lim;
end $fn$;

create or replace function public.qb_my_access() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare lim numeric; used integer; subscribed boolean; is_learner boolean;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select exists (select 1 from public.student_profiles where user_id = auth.uid()) into is_learner;
  begin lim := (quizbox_core.setting('access.free_practice_sessions') #>> '{}')::numeric; exception when others then lim := null; end;
  select exists (select 1 from public.access_entitlements e where e.user_id = auth.uid() and e.kind = 'subscription' and e.status = 'active'
                   and e.valid_from <= now() and (e.valid_until is null or e.valid_until > now())) into subscribed;
  select count(*)::integer into used from public.assessments a where a.owner_user_id = auth.uid() and a.reference_type = 'SELF_PRACTICE';
  return jsonb_build_object('gated', is_learner and lim is not null and lim >= 0, 'free_limit', lim, 'used', used,
    'remaining', case when lim is null then null else greatest(lim - used, 0) end,
    'subscribed', subscribed, 'exhausted', is_learner and public.qb_free_allowance_exhausted(auth.uid()));
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


revoke all on function public.qb_free_allowance_exhausted(uuid) from public, anon, authenticated;
revoke all on function public.qb_my_access() from public, anon;
grant execute on function public.qb_my_access() to authenticated;

commit;
