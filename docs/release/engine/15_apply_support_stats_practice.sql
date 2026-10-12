-- QuizBox: apply the three new migrations in one paste (Supabase SQL editor, production project). Each is additive and idempotent
-- (create or replace of functions and two read policies; no table or data change). Expect 'Success' and then one row of true values.
--   1. 20261012180000 reviewer support capability + curriculum pool for admin dropdowns
--   2. 20261012190000 public platform figures for the front page (counts only)
--   3. 20261012200000 simple practice for learners (menu + build)
-- Rollbacks: supabase/rollback/support_and_catalogue.sql, public_platform_stats.sql, quick_practice.sql.

-- ===== 1 of 3: 20261012180000_reviewer_support_and_catalogue.sql =====
-- Reviewer support and the curriculum pool for admin forms (2026-10-12).
--   1. New capability 'sme_support': a super admin can let a support person onboard reviewers and grant reviewer domains
--      (sme_profiles and sme_domain_assignments only; markets, currencies, compensation and capabilities stay super-admin).
--   2. qb_curriculum_catalogue(): the levels, grades and subjects that exist in the active curricula, per market, so admin forms offer
--      them as dropdowns instead of free text.
-- Replaces two functions and two read policies; adds one function. No table or data changes. Rollback: supabase/rollback/support_and_catalogue.sql.
begin;

alter table public.user_capabilities drop constraint if exists user_capabilities_capability_check;
alter table public.user_capabilities add constraint user_capabilities_capability_check check (capability in (
 'super_admin','content_admin','sme_reviewer','senior_sme_reviewer','competition_admin','sponsor_admin','finance_admin',
 'platform_admin','content_manager','competition_manager','support_agent','school_admin','school_owner','sponsor_user','parent_guardian','senior_reviewer',
 'sme_support'));

create or replace function public.qb_sme_context() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('super_admin',quizbox_sme.has_capability('super_admin'),'finance_admin',quizbox_sme.has_capability('finance_admin'),
 'content_admin',quizbox_sme.has_capability('content_admin'),'sme_support',quizbox_sme.has_capability('sme_support'),
 'reviewer',exists(select 1 from public.sme_profiles where user_id=auth.uid() and active and reviewer_status='verified'));
$$;

create or replace function public.qb_sme_configure(p_entity text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare key text; columns text; values_sql text; updates text; partial_updates text; result jsonb; payload jsonb:=p_data; table_id regclass;
begin
 if not quizbox_sme.has_capability('super_admin') then
  -- A reviewer-support person (capability sme_support, granted by a super admin) manages reviewer profiles and their domains only:
  -- never currencies, countries, markets, compensation or capabilities.
  if not (quizbox_sme.has_capability('sme_support') and p_entity in ('sme_profiles','sme_domain_assignments')) then raise exception 'QB_SME_CONFIGURATION_DENIED' using errcode='42501'; end if;
 end if;
 if p_entity not in ('currencies','countries','markets','sme_profiles','sme_domain_assignments','compensation_policies','compensation_policy_versions','user_capabilities') then raise exception 'QB_INVALID_ENTITY'; end if;
 if jsonb_typeof(payload)<>'object' or octet_length(payload::text)>20000 then raise exception 'QB_INVALID_CONFIG'; end if;
 key:=case when p_entity='currencies' then 'code' when p_entity='sme_profiles' then 'user_id' else 'id' end;
 if p_entity='user_capabilities' then
  insert into public.user_capabilities(user_id,capability,active,granted_by) values((payload->>'user_id')::uuid,payload->>'capability',coalesce((payload->>'active')::boolean,true),auth.uid())
  on conflict(user_id,capability) do update set active=excluded.active,granted_by=excluded.granted_by returning to_jsonb(user_capabilities.*) into result; return result;
 end if;
 if key='id' and coalesce(payload->>'id','')='' then payload:=payload||jsonb_build_object('id',gen_random_uuid()); end if;
 if p_entity='compensation_policy_versions' then payload:=payload||jsonb_build_object('created_by',auth.uid()); end if;
 if payload ? 'created_at' or payload ? 'updated_at' then raise exception 'QB_INVALID_CONFIG'; end if;
 table_id:=to_regclass('public.'||p_entity);
 if exists(select 1 from jsonb_object_keys(payload) k where not exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=table_id and a.attname=k and a.attnum>0 and not a.attisdropped)) then raise exception 'QB_INVALID_CONFIG_FIELD'; end if;
 if p_entity<>'compensation_policy_versions' then
  execute format('select to_jsonb(t) from public.%I t where t.%I=(jsonb_populate_record(null::public.%I,$1)).%I for update',p_entity,key,p_entity,key) into result using payload;
  if result is not null then
   if p_entity='markets' and payload ? 'configuration' then payload:=payload||jsonb_build_object('configuration',coalesce(result->'configuration','{}'::jsonb)||(payload->'configuration')); end if;
   select string_agg(format('%I=(jsonb_populate_record(null::public.%I,$1)).%I',k,p_entity,k),',') into partial_updates from jsonb_object_keys(payload) k where k<>key;
   if partial_updates is not null then
    execute format('update public.%I set %s where %I=(jsonb_populate_record(null::public.%I,$1)).%I returning to_jsonb(%I.*)',p_entity,partial_updates,key,p_entity,key,p_entity) into result using payload;
   end if;
   return result;
  end if;
 end if;
 select string_agg(format('%I',k),','),string_agg(format('(jsonb_populate_record(null::public.%I,$1)).%I',p_entity,k),','),
 string_agg(format('%I=excluded.%I',k,k),',') filter(where k<>key) into columns,values_sql,updates from jsonb_object_keys(payload) k;
 execute format('insert into public.%I(%s) values(%s) %s returning to_jsonb(%I.*)',p_entity,columns,values_sql,
 case when p_entity='compensation_policy_versions' then '' else format('on conflict(%I) do update set %s',key,updates) end,p_entity) into result using payload;
 return result;
end $$;

-- Reviewer-support people can read the two tables they manage.
drop policy if exists sme_read on public.sme_profiles;
create policy sme_read on public.sme_profiles for select to authenticated using (
  quizbox_sme.has_capability('super_admin') or user_id=auth.uid() or quizbox_sme.has_capability('content_admin') or quizbox_sme.has_capability('finance_admin')
  or quizbox_sme.has_capability('sme_support'));
drop policy if exists sme_read on public.sme_domain_assignments;
create policy sme_read on public.sme_domain_assignments for select to authenticated using (
  quizbox_sme.has_capability('super_admin') or reviewer_id=auth.uid() or quizbox_sme.has_capability('content_admin') or quizbox_sme.has_capability('finance_admin')
  or quizbox_sme.has_capability('sme_support'));

-- The curriculum pool: every level, grade and subject that exists in an active curriculum of a market. Admin forms use it for cascading dropdowns.
create or replace function public.qb_curriculum_catalogue() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not (quizbox_sme.has_capability('super_admin') or quizbox_sme.has_capability('content_admin') or quizbox_sme.has_capability('sme_support')) then
    raise exception 'QB_CATALOGUE_ACCESS_DENIED' using errcode='42501';
  end if;
  return jsonb_build_object(
    'markets', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.name) from public.markets m where m.active), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('market_id', x.market_id, 'level', x.level, 'grade', x.grade, 'subject', x.subject) order by x.level, x.grade, x.subject)
      from (select distinct mc.market_id, n.education_level as level, coalesce(n.canonical_grade_code, n.grade_code) as grade, n.subject_code as subject
              from public.curriculum_nodes n
              join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
             where n.is_active and n.node_type = 'subject' and n.subject_code is not null and n.education_level is not null
               and coalesce(n.canonical_grade_code, n.grade_code) is not null) x), '[]'::jsonb));
end $$;
revoke all on function public.qb_curriculum_catalogue() from public, anon;
grant execute on function public.qb_curriculum_catalogue() to authenticated;

commit;

-- ===== 2 of 3: 20261012190000_public_platform_stats.sql =====
-- Public platform figures for the front page, read live from the user and question tables.
-- A reviewed public contract (listed in lib/operations/public-rpc-allowlist.ts): anonymous callers receive COUNTS ONLY. No name, id, email,
-- school or any row-level value leaves the database. Learners are grouped by the level their grade belongs to; questions and curriculum
-- indicators by the education level of the curriculum node they sit on. Test fixtures (source_type DEV_*) and inactive records are excluded.
-- One new function, no table or policy change. Rollback: supabase/rollback/public_platform_stats.sql.
begin;

create or replace function public.qb_public_platform_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  learners jsonb; questions jsonb; indicators jsonb; people jsonb;
begin
  select jsonb_build_object(
      'total', count(*),
      'primary', count(*) filter (where lvl = 'PRIMARY'),
      'jhs', count(*) filter (where lvl = 'JHS'),
      'shs', count(*) filter (where lvl = 'SHS'))
    into learners
    from (select case
            when upper(coalesce(nullif(s.grade_code, ''), s.grade::text)) ~ '^B[1-6]$' then 'PRIMARY'
            when upper(coalesce(nullif(s.grade_code, ''), s.grade::text)) ~ '^B(7|8|9)$' then 'JHS'
            when upper(coalesce(nullif(s.grade_code, ''), s.grade::text)) ~ '^(B10|SHS ?[123])$' then 'SHS'
            else upper(coalesce(nullif(s.education_level, ''), 'OTHER')) end as lvl
            from public.student_profiles s where s.status::text = 'active') x;

  select jsonb_build_object(
      'total', count(*),
      'primary', count(*) filter (where upper(n.education_level) = 'PRIMARY'),
      'jhs', count(*) filter (where upper(n.education_level) = 'JHS'),
      'shs', count(*) filter (where upper(n.education_level) = 'SHS'))
    into questions
    from public.questions q left join public.curriculum_nodes n on n.id = q.curriculum_node_id
   where q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated')
     and coalesce(q.source_type, '') not like 'DEV\_%';

  select jsonb_build_object(
      'total', count(*),
      'primary', count(*) filter (where upper(n.education_level) = 'PRIMARY'),
      'jhs', count(*) filter (where upper(n.education_level) = 'JHS'),
      'shs', count(*) filter (where upper(n.education_level) = 'SHS'))
    into indicators
    from public.curriculum_nodes n join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
   where n.is_active and n.node_type = 'learning_indicator';

  select jsonb_build_object(
      'teachers', (select count(*) from public.teacher_profiles where status::text = 'active'),
      'reviewers', (select count(*) from public.sme_profiles where active and reviewer_status = 'verified'),
      'schools', (select count(*) from public.institutions where status::text = 'active'),
      'sponsors', (select count(*) from public.sponsor_profiles where upper(coalesce(status::text, '')) not in ('SUSPENDED', 'REJECTED', 'DISABLED', 'ARCHIVED', 'DELETED')),
      'markets', (select count(*) from public.markets where active and not coalesce(is_test, false)))
    into people;

  return jsonb_build_object('learners', learners, 'questions', questions, 'indicators', indicators, 'people', people, 'as_of', now());
end $$;

revoke all on function public.qb_public_platform_stats() from public;
grant execute on function public.qb_public_platform_stats() to anon, authenticated;

commit;

-- ===== 3 of 3: 20261012200000_quick_practice.sql =====
-- Quick practice for learners: choose a subject, tick topics, choose how many questions, start. The curriculum hierarchy (strands, sub-strands,
-- content standards, indicators) stays in the database exactly as it is; the learner only ever sees subject names, topic names and counts.
--   qb_practice_menu()                          what this learner can practise: subjects of their own grade in their market's active curricula,
--                                               each with its topics (sub-strands) that have approved questions, and how many.
--   qb_start_quick_practice(topic_ids, count)   builds a private practice assessment (owner = the learner) from approved questions of the
--                                               ticked topics, spread evenly across them, and returns its id; the learner then starts it
--                                               through the existing attempt flow, so grading, snapshots and results are unchanged.
-- Eligibility is decided here, not in the browser: a topic outside the learner's grade or market is refused. Additive: two functions only.
-- Rollback: supabase/rollback/quick_practice.sql.
begin;

create or replace function public.qb_practice_menu() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare sp public.student_profiles; g text; m uuid;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into sp from public.student_profiles where user_id = auth.uid();
  if sp.id is null then raise exception 'QB_STUDENT_REQUIRED' using errcode = '42501'; end if;
  g := upper(coalesce(nullif(sp.grade_code, ''), sp.grade::text));
  select default_market_id into m from public.profiles where id = auth.uid();
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
             jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'strand', coalesce(st.title, ''), 'available', a.n) order by st.sort_order, t.sort_order, t.title) as topics
        from avail a join public.curriculum_nodes s on s.id = a.subject_id
        join public.curriculum_nodes t on t.id = a.topic_id left join public.curriculum_nodes st on st.id = t.parent_id and st.node_type = 'strand'
       group by s.id, s.title, s.subject_code)
    select jsonb_agg(jsonb_build_object('id', id, 'name', title, 'subject_code', subject_code, 'available', total, 'topics', topics) order by title) from subj), '[]'::jsonb));
end $$;

create or replace function public.qb_start_quick_practice(p_topic_ids uuid[], p_count integer default 10) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sp public.student_profiles; g text; m uuid; subj public.curriculum_nodes; v_assessment public.assessments; v_available integer; v_used integer;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if p_topic_ids is null or cardinality(p_topic_ids) not between 1 and 40 then raise exception 'QB_PRACTICE_TOPICS_REQUIRED'; end if;
  if p_count is null or p_count not between 3 and 30 then raise exception 'QB_PRACTICE_COUNT_INVALID'; end if;
  select * into sp from public.student_profiles where user_id = auth.uid();
  if sp.id is null then raise exception 'QB_STUDENT_REQUIRED' using errcode = '42501'; end if;
  g := upper(coalesce(nullif(sp.grade_code, ''), sp.grade::text));
  select default_market_id into m from public.profiles where id = auth.uid();

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
  values ('PRACTICE', 'student', auth.uid(), coalesce(subj.subject_code, subj.title), subj.title,
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
end $$;

revoke all on function public.qb_practice_menu(), public.qb_start_quick_practice(uuid[], integer) from public, anon;
grant execute on function public.qb_practice_menu(), public.qb_start_quick_practice(uuid[], integer) to authenticated;

commit;

-- ===== check (read only) =====
select to_regprocedure('public.qb_curriculum_catalogue()') is not null as catalogue_installed,
       to_regprocedure('public.qb_public_platform_stats()') is not null as public_stats_installed,
       to_regprocedure('public.qb_practice_menu()') is not null as practice_menu_installed,
       to_regprocedure('public.qb_start_quick_practice(uuid[],integer)') is not null as quick_practice_installed;
