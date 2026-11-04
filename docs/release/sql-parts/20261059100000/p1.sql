-- Challenge and competition content from the QuizBox bank across subjects and topics. A creator (teacher, sponsor, school, learner) chooses a grade, then one or more
-- subjects, each with a number of questions and, if wanted, the topics: qb_challenge_bank_menu lists what is available, challenge_pull_bank_sections copies the picked
-- questions into the draft. Several subjects only for Primary and JHS, as everywhere else. A learner uses their own grade. Pulls are additive, so a competition can
-- take questions from more than one grade by pulling again. Also closes a gap: the older challenge_pull_bank (one subject code) checked only status = 'active', so it
-- could copy in a question that was not approved, a development question or one the market gate would hide. It now applies the same rules as practice.
-- Additive apart from that one function. Rollback: supabase/rollback/challenge_bank_sections.sql.

-- The subjects and topics of one grade that have usable questions (same rules as the practice menu).
create or replace function public.qb_bank_subjects(g text, m uuid) returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select coalesce((
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
         and q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated') and public.qb_question_is_listable(q)
         and q.answer_type = 'SINGLE_CHOICE' and q.option_c is not null and q.option_d is not null and upper(q.correct_answer) in ('A', 'B', 'C', 'D')
         and coalesce(q.source_type, '') not like 'DEV\_%'
       group by d.subject_id, d.topic_id),
    subj as (
      select s.id, s.title, s.subject_code, sum(a.n)::integer as total,
             jsonb_agg(jsonb_build_object('id', t.id, 'title', public.qb_topic_label(t.id), 'strand', case when public.qb_label_is_code(st.title) then '' else coalesce(st.title, '') end, 'available', a.n) order by st.sort_order, t.sort_order, t.title) as topics
        from avail a join public.curriculum_nodes s on s.id = a.subject_id
        join public.curriculum_nodes t on t.id = a.topic_id left join public.curriculum_nodes st on st.id = t.parent_id and st.node_type = 'strand'
       group by s.id, s.title, s.subject_code)
    select jsonb_agg(jsonb_build_object('id', id, 'name', title, 'subject_code', subject_code, 'available', total, 'topics', topics) order by title) from subj), '[]'::jsonb)
$fn$;
revoke all on function public.qb_bank_subjects(text, uuid) from public, anon, authenticated;

create or replace function public.qb_challenge_bank_menu(p_grade text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare sp public.student_profiles; g text; m uuid;
begin
  if not public.qb_challenge_creator() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into sp from public.student_profiles where user_id = auth.uid();
  select default_market_id into m from public.profiles where id = auth.uid();
  if sp.id is not null then
    g := upper(coalesce(nullif(sp.grade_code, ''), sp.grade::text));
    if g = 'B10' then g := 'SHS1'; end if;
  else
    g := upper(nullif(btrim(coalesce(p_grade, '')), ''));
    if g is null then
      return jsonb_build_object('grade', null, 'subjects', '[]'::jsonb, 'grades', coalesce((
        select jsonb_agg(x order by x) from (select distinct upper(coalesce(n.canonical_grade_code, n.grade_code)) as x
          from public.curriculum_nodes n join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
         where n.is_active and n.node_type = 'subject' and coalesce(n.canonical_grade_code, n.grade_code) is not null and (m is null or mc.market_id = m)) y), '[]'::jsonb));
    end if;
  end if;
  return jsonb_build_object('grade', g, 'subjects', public.qb_bank_subjects(g, m));
end $fn$;
