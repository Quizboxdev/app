-- Rollback for 20261059100000_challenge_bank_sections.sql: removes the sections picker and puts challenge_pull_bank back as the Challenges extensions migration defined it
-- (status = 'active' only). Questions already copied into drafts stay (they are ordinary challenge questions).
begin;
drop function if exists public.challenge_pull_bank_sections(uuid, jsonb, text, integer);
drop function if exists public.qb_challenge_bank_menu(text);
drop function if exists public.qb_bank_subjects(text, uuid);

create or replace function public.challenge_pull_bank(p_id uuid, p_subject_code text, p_grade text, p_count integer, p_stage integer default 1) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; have integer; added integer := 0; r record;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status <> 'DRAFT' then raise exception 'ONLY_DRAFT_EDITABLE' using errcode = '55000'; end if;
  if p_stage not between 1 and c.stage_count then raise exception 'INVALID_QUESTIONS' using errcode = '22023'; end if;
  select count(*) into have from public.challenge_questions where campaign_id = p_id;
  for r in
    select q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, upper(q.correct_answer) as ans, q.explanation
      from public.questions q
     where q.status = 'active' and q.answer_type = 'SINGLE_CHOICE' and q.subject_code = p_subject_code and (p_grade is null or q.grade::text = p_grade)
       and q.option_c is not null and q.option_d is not null and upper(q.correct_answer) in ('A','B','C','D')
       and not exists (select 1 from public.challenge_questions cq where cq.campaign_id = p_id and cq.source_question_id = q.id)
     order by random() limit least(greatest(coalesce(p_count, 10), 1), 100)
  loop
    have := have + 1; added := added + 1;
    insert into public.challenge_questions(campaign_id, position, question_text, options, correct_index, explanation, source_question_id, stage_no)
    values (p_id, have, r.question_text, jsonb_build_array(r.option_a, r.option_b, r.option_c, r.option_d), ascii(r.ans) - 65, r.explanation, r.id, p_stage);
  end loop;
  perform public.qb_challenge_audit('challenge_bank_pulled', p_id, jsonb_build_object('added', added, 'subject', p_subject_code, 'stage', p_stage));
  return jsonb_build_object('ok', true, 'added', added, 'total', have);
end $fn$;
commit;
