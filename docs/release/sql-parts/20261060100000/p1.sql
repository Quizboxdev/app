begin;
-- The class levels offered when a creator adds questions from the QuizBox bank are only those that have at least one usable (approved, listable, four-option) question,
-- so nobody picks a level and is then told it is empty. The subjects shown for a level were already limited to ones with usable questions; this applies the same
-- rule to the level list, using the same function (qb_bank_subjects), so the two can never disagree. Only qb_challenge_bank_menu changes; the signature is the same.
-- Rollback: supabase/rollback/challenge_bank_levels_with_questions.sql (puts back the previous definition from 20261059100000).

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
         where n.is_active and n.node_type = 'subject' and coalesce(n.canonical_grade_code, n.grade_code) is not null and (m is null or mc.market_id = m)) y
         where jsonb_array_length(public.qb_bank_subjects(y.x, m)) > 0), '[]'::jsonb));
    end if;
  end if;
  return jsonb_build_object('grade', g, 'subjects', public.qb_bank_subjects(g, m));
end $fn$;
revoke all on function public.qb_challenge_bank_menu(text) from public, anon;
grant execute on function public.qb_challenge_bank_menu(text) to authenticated;
commit;
