-- Faster class-level list for adding questions from the bank. 20261060100000 built the list by computing the whole subject list of every class level, which took 11 seconds on
-- Preview and hit the 8-second limit for signed-in users, so the picker showed an error. This version asks, for each level, only "is there at least one usable question?" and
-- stops at the first one. The rule for a usable question is the same as in qb_bank_subjects (approved, listable, four options, not a development question, under a topic).
-- Only qb_challenge_bank_menu changes; the signature is the same.
-- Rollback: supabase/rollback/challenge_bank_levels_fast.sql (back to the original list of every level; it does not bring back the slow version).

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
        select jsonb_agg(y.x order by y.x) from (select distinct upper(coalesce(n.canonical_grade_code, n.grade_code)) as x
          from public.curriculum_nodes n join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
         where n.is_active and n.node_type = 'subject' and coalesce(n.canonical_grade_code, n.grade_code) is not null and (m is null or mc.market_id = m)) y
         where exists (
           with recursive down(id, subject_id, topic_id, node_type, depth) as (
             select n.id, n.id, null::uuid, n.node_type, 0
               from public.curriculum_nodes n join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
              where n.is_active and n.node_type = 'subject' and upper(coalesce(n.canonical_grade_code, n.grade_code)) = y.x and (m is null or mc.market_id = m)
             union all
             select c.id, d.subject_id, case when c.node_type = 'sub_strand' then c.id else d.topic_id end, c.node_type, d.depth + 1
               from down d join public.curriculum_nodes c on c.parent_id = d.id where c.is_active and d.depth < 8)
           select 1 from down d join public.questions q on q.curriculum_node_id = d.id
            where d.node_type = 'learning_indicator' and d.topic_id is not null
              and q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated') and public.qb_question_is_listable(q)
              and q.answer_type = 'SINGLE_CHOICE' and q.option_c is not null and q.option_d is not null and upper(q.correct_answer) in ('A', 'B', 'C', 'D')
              and coalesce(q.source_type, '') not like 'DEV\_%'
            limit 1)), '[]'::jsonb));
    end if;
  end if;
  return jsonb_build_object('grade', g, 'subjects', public.qb_bank_subjects(g, m));
end $fn$;
revoke all on function public.qb_challenge_bank_menu(text) from public, anon;
grant execute on function public.qb_challenge_bank_menu(text) to authenticated;
