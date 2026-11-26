-- ───────────── question selection ─────────────
-- Usable bank questions under a subject (optionally narrowed to chosen strands, sub-strands or indicators) for the division's class levels.
create or replace function quizbox_interschool.pool(p_levels text[], p_subject uuid, p_nodes uuid[])
returns table(question_id uuid, difficulty text) language sql stable security definer set search_path = '' as $fn$
  with recursive tree(id, depth) as (
    select n.id, 0 from public.curriculum_nodes n
     where n.is_active and ((p_nodes is null and n.id = p_subject) or (p_nodes is not null and n.id = any(p_nodes)))
    union
    select ch.id, t.depth + 1 from tree t join public.curriculum_nodes ch on ch.parent_id = t.id where ch.is_active and t.depth < 8),
  under_subject(id, depth) as (
    select p_subject, 0
    union
    select ch.id, u.depth + 1 from under_subject u join public.curriculum_nodes ch on ch.parent_id = u.id where u.depth < 8)
  select q.id, lower(coalesce(nullif(q.difficulty_label, ''), q.difficulty_code::text))
    from public.questions q
   where q.curriculum_node_id in (select t.id from tree t) and q.curriculum_node_id in (select u.id from under_subject u)
     and upper(coalesce(nullif(q.source_grade_code, ''), q.grade::text)) = any(p_levels)
     and q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated') and (q.tenant_id is null or q.tenant_id = public.qb_public_tenant_id())
     and upper(coalesce(q.answer_type, 'SINGLE_CHOICE')) in ('SINGLE_CHOICE', 'TRUE_FALSE') and upper(coalesce(q.correct_answer, '')) in ('A', 'B', 'C', 'D')
     and coalesce(q.source_type, '') not like 'DEV\_%' and public.qb_question_is_listable(q)
$fn$;

-- Checks a round's sections: [{subject_id, count, node_ids?, difficulty?: {easy, medium, hard}}]. Returns each section with the number of usable questions.
create or replace function quizbox_interschool.section_report(p_levels text[], p_sections jsonb) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare s jsonb; subject uuid; n integer; nodes uuid[]; have integer; d text; need integer; short jsonb; out jsonb := '[]'::jsonb; seen text[] := '{}';
begin
  for s in select value from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(s) <> 'object' or coalesce(s ->> 'subject_id', '') !~ '^[0-9a-fA-F-]{36}$' or coalesce(s ->> 'count', '') !~ '^[0-9]{1,3}$' then raise exception 'IS_SECTION_INVALID' using errcode = '22023'; end if;
    subject := (s ->> 'subject_id')::uuid; n := (s ->> 'count')::integer;
    if n < 1 then raise exception 'IS_SECTION_INVALID' using errcode = '22023'; end if;
    if subject::text = any(seen) then raise exception 'IS_SECTION_DUPLICATE_SUBJECT' using errcode = '22023'; end if;
    seen := seen || subject::text;
    if not exists (select 1 from public.curriculum_nodes c where c.id = subject and c.is_active and c.node_type = 'subject'
                    and upper(coalesce(c.canonical_grade_code, c.grade_code)) = any(p_levels)) then raise exception 'IS_SUBJECT_NOT_FOR_LEVEL' using errcode = '22023'; end if;
    nodes := case when jsonb_typeof(s -> 'node_ids') = 'array' and jsonb_array_length(s -> 'node_ids') > 0 then array(select jsonb_array_elements_text(s -> 'node_ids'))::uuid[] end;
    short := '[]'::jsonb;
    if jsonb_typeof(s -> 'difficulty') = 'object' then
      if (select coalesce(sum(value::integer), 0) from jsonb_each_text(s -> 'difficulty') where key in ('easy', 'medium', 'hard')) <> n
         or exists (select 1 from jsonb_object_keys(s -> 'difficulty') k where k not in ('easy', 'medium', 'hard')) then raise exception 'IS_DIFFICULTY_MIX_INVALID' using errcode = '22023'; end if;
      for d, need in select key, value::integer from jsonb_each_text(s -> 'difficulty') loop
        select count(*) into have from quizbox_interschool.pool(p_levels, subject, nodes) p where p.difficulty = d;
        if have < need then short := short || jsonb_build_object('difficulty', d, 'need', need, 'have', have); end if;
      end loop;
    end if;
    select count(*) into have from quizbox_interschool.pool(p_levels, subject, nodes);
    out := out || jsonb_build_array(jsonb_build_object('subject_id', subject, 'subject', (select title from public.curriculum_nodes where id = subject), 'need', n, 'have', have,
             'short', short, 'ok', have >= n and jsonb_array_length(short) = 0));
  end loop;
  return out;
end $fn$;

-- Freezes a paper: copies the chosen questions (text, options, key, version) so later edits to the bank cannot change a competition.
create or replace function quizbox_interschool.freeze_paper(p_round uuid, p_fixture uuid, p_levels text[], p_sections jsonb) returns uuid language plpgsql security definer set search_path = '' as $fn$
declare paper uuid; s jsonb; subject uuid; nodes uuid[]; n integer; pos integer := 0; d text; need integer; got integer; report jsonb;
begin
  report := quizbox_interschool.section_report(p_levels, p_sections);
  if exists (select 1 from jsonb_array_elements(report) r where not (r.value ->> 'ok')::boolean) then raise exception 'IS_NOT_ENOUGH_QUESTIONS' using errcode = '55000', detail = report::text; end if;
  insert into quizbox_interschool.papers(round_id, fixture_id) values (p_round, p_fixture) returning id into paper;
  for s in select value from jsonb_array_elements(p_sections) loop
    subject := (s ->> 'subject_id')::uuid; n := (s ->> 'count')::integer;
    nodes := case when jsonb_typeof(s -> 'node_ids') = 'array' and jsonb_array_length(s -> 'node_ids') > 0 then array(select jsonb_array_elements_text(s -> 'node_ids'))::uuid[] end;
    got := 0;
    for d, need in
      select key, value::integer from jsonb_each_text(case when jsonb_typeof(s -> 'difficulty') = 'object' then s -> 'difficulty' else jsonb_build_object('any', n) end) loop
      insert into quizbox_interschool.paper_questions(paper_id, position, source_question_id, source_version, subject_node_id, difficulty, question_text, options, correct_index, explanation)
      select paper, pos + row_number() over (), x.id, x.version, subject, x.difficulty, x.question_text,
             case when upper(coalesce(x.answer_type, '')) = 'TRUE_FALSE' then jsonb_build_array(x.option_a, x.option_b) else jsonb_build_array(x.option_a, x.option_b, x.option_c, x.option_d) end,
             ascii(upper(x.correct_answer)) - 65, x.explanation
        from (select cand.* from (
                select q.id, q.version, p.difficulty, q.question_text, q.answer_type, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, q.explanation
                  from quizbox_interschool.pool(p_levels, subject, nodes) p join public.questions q on q.id = p.question_id
                 where (d = 'any' or p.difficulty = d)
                   -- a question already used in any paper of this division is not repeated
                   and not exists (select 1 from quizbox_interschool.paper_questions pq join quizbox_interschool.papers pp on pp.id = pq.paper_id join quizbox_interschool.rounds r on r.id = pp.round_id
                                    where r.division_id = (select r2.division_id from quizbox_interschool.rounds r2 where r2.id = p_round) and pq.source_question_id = q.id)
                 order by random() limit need * 3 + 30) cand
              -- the full availability rule (approved sources, market) is checked on the short list only
              where (select public.qb_question_is_available(q2) from public.questions q2 where q2.id = cand.id)
              limit need) x;
      get diagnostics need = row_count;
      pos := pos + need; got := got + need;
    end loop;
    if got < n then raise exception 'IS_NOT_ENOUGH_QUESTIONS' using errcode = '55000', detail = 'questions already used in other rounds of this division'; end if;
  end loop;
  return paper;
end $fn$;

-- ───────────── configuration ─────────────
create or replace function quizbox_interschool.slugify(p_title text) returns text language plpgsql volatile security definer set search_path = '' as $fn$
declare base text; s text; n integer := 0;
begin
  base := regexp_replace(regexp_replace(lower(btrim(p_title)), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g');
  if length(base) < 3 then base := 'competition'; end if;
  base := left(base, 60); base := regexp_replace(base, '-+$', ''); s := base;
  while exists (select 1 from quizbox_interschool.competitions where slug = s) loop n := n + 1; s := base || '-' || n; end loop;
  return s;
end $fn$;
