-- Learners keep to academic content. A learner (profile role "student") can still create and share a challenge or competition, but only from approved QuizBox curriculum
-- questions, for friends and classmates: never listed publicly, no typed questions, no uploaded material, no prizes, no logo or branding, no reading material. Joining a public
-- competition made by someone else is unchanged. Teachers, sponsors and admins are unaffected.
-- Enforced by triggers, so no screen or tool can get around it: a learner's campaign is quietly set to the curriculum category and to link-only if it was public, and anything
-- extra is refused with ACADEMIC_ONLY. Existing learner campaigns are corrected the next time they are changed.
-- Also: questions now keep the bank question they came from when a list is saved (needed so a learner can remove one without losing the link).
-- Additive and idempotent. Rollback: supabase/rollback/student_academic_limits.sql.


create or replace function public.qb_owner_is_student(p_owner uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.profiles p where p.id = p_owner and lower(p.role::text) = 'student');
$fn$;
revoke all on function public.qb_owner_is_student(uuid) from public, anon, authenticated;

-- 1. The campaign itself.
create or replace function public.qb_trg_student_campaign() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if public.qb_owner_is_student(new.owner_id) then
    new.category := 'curriculum';
    if new.visibility = 'PUBLIC' then new.visibility := 'UNLISTED'; end if;
    new.reward_text := null; new.brand := '{}'::jsonb; new.reader_enabled := false; new.target_levels := '{}';
    new.audience_class_id := null; new.audience_institution_id := null;
  end if;
  return new;
end $fn$;
drop trigger if exists qb_student_campaign on public.challenge_campaigns;
create trigger qb_student_campaign before insert or update on public.challenge_campaigns for each row execute function public.qb_trg_student_campaign();

-- 2. Questions: only bank questions for a learner.
create or replace function public.qb_trg_student_question() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if public.qb_owner_is_student((select owner_id from public.challenge_campaigns where id = new.campaign_id)) then
    -- The saved question must be the bank question word for word (text, four options, correct answer): a learner cannot keep the link and change the wording.
    if new.source_question_id is null or not exists (
         select 1 from public.questions q where q.id = new.source_question_id and q.status = 'active' and q.question_text = new.question_text
            and jsonb_build_array(q.option_a, q.option_b, q.option_c, q.option_d) = new.options and ascii(upper(q.correct_answer)) - 65 = new.correct_index) then
      raise exception 'ACADEMIC_ONLY' using errcode = '42501';
    end if;
  end if;
  return new;
end $fn$;
drop trigger if exists qb_student_question on public.challenge_questions;
create trigger qb_student_question before insert on public.challenge_questions for each row execute function public.qb_trg_student_question();

-- 3. Material and prizes: not for learners.
create or replace function public.qb_trg_student_asset() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if public.qb_owner_is_student(new.owner_id) then raise exception 'ACADEMIC_ONLY' using errcode = '42501'; end if;
  return new;
end $fn$;
create or replace function public.qb_trg_student_prize() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if public.qb_owner_is_student((select owner_id from public.challenge_campaigns where id = new.campaign_id)) then raise exception 'ACADEMIC_ONLY' using errcode = '42501'; end if;
  return new;
end $fn$;
drop trigger if exists qb_student_assets on public.challenge_content_assets;
create trigger qb_student_assets before insert on public.challenge_content_assets for each row execute function public.qb_trg_student_asset();
drop trigger if exists qb_student_prizes on public.challenge_prizes;
create trigger qb_student_prizes before insert on public.challenge_prizes for each row execute function public.qb_trg_student_prize();

-- 4. Saving a question list keeps the bank question each one came from (only if it is a real bank question).
create or replace function public.challenge_set_questions(p_id uuid, p_questions jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; q jsonb; i integer := 0; n integer; v_stage integer; v_chunk uuid; v_quote text; v_body text; v_src uuid;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status <> 'DRAFT' then raise exception 'ONLY_DRAFT_EDITABLE' using errcode = '55000'; end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) not between 0 and 300 then raise exception 'INVALID_QUESTIONS' using errcode = '22023'; end if;
  delete from public.challenge_questions where campaign_id = p_id;
  for q in select * from jsonb_array_elements(p_questions) loop
    i := i + 1;
    n := jsonb_array_length(q->'options');
    if (q->>'correct_index')::int not between 0 and n - 1 then raise exception 'INVALID_QUESTIONS' using errcode = '22023'; end if;
    v_stage := coalesce((q->>'stage_no')::int, 1);
    if v_stage not between 1 and c.stage_count then raise exception 'INVALID_QUESTIONS' using errcode = '22023'; end if;
    v_chunk := nullif(q->>'source_chunk_id', '')::uuid; v_quote := nullif(btrim(q->>'source_quote'), '');
    select x.id into v_src from public.questions x where x.id = nullif(q->>'source_question_id', '')::uuid;
    if v_chunk is not null then
      select ch.body into v_body from public.challenge_source_chunks ch join public.challenge_content_versions v on v.id = ch.version_id
        join public.challenge_content_assets a on a.id = v.asset_id where ch.id = v_chunk and a.campaign_id = p_id;
      if not found then raise exception 'INVALID_SOURCE' using errcode = '22023'; end if;
      if v_quote is not null and position(public.qb_challenge_norm(v_quote) in public.qb_challenge_norm(v_body)) = 0 then raise exception 'QUOTE_NOT_IN_SOURCE' using errcode = '22023'; end if;
    elsif v_quote is not null then raise exception 'INVALID_SOURCE' using errcode = '22023'; end if;
    insert into public.challenge_questions(campaign_id, position, question_text, options, correct_index, explanation, source_question_id, stage_no, source_chunk_id, source_quote)
    values (p_id, i, btrim(q->>'question_text'), q->'options', (q->>'correct_index')::int, nullif(btrim(q->>'explanation'), ''), v_src, v_stage, v_chunk, v_quote);
  end loop;
  update public.challenge_campaigns set updated_at = now() where id = p_id;
  perform public.qb_challenge_audit('challenge_questions_set', p_id, jsonb_build_object('count', i));
  return jsonb_build_object('ok', true, 'count', i);
end $fn$;

create or replace function public.challenge_creator_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  c := public.qb_challenge_owned(p_id);
  return jsonb_build_object('campaign', to_jsonb(c), 'student_limited', public.qb_owner_is_student(c.owner_id),
    'stages', coalesce((select jsonb_agg(to_jsonb(s) - 'campaign_id' order by s.stage_no) from public.challenge_stages s where s.campaign_id = p_id), '[]'::jsonb),
    'prizes', coalesce((select jsonb_agg(to_jsonb(p) - 'campaign_id' order by p.rank_from) from public.challenge_prizes p where p.campaign_id = p_id), '[]'::jsonb),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'position', q.position, 'question_text', q.question_text, 'options', q.options, 'correct_index', q.correct_index,
        'explanation', q.explanation, 'stage_no', q.stage_no, 'source_chunk_id', q.source_chunk_id, 'source_quote', q.source_quote, 'source_question_id', q.source_question_id) order by q.position)
        from public.challenge_questions q where q.campaign_id = p_id), '[]'::jsonb));
end $fn$;

revoke all on function public.challenge_set_questions(uuid, jsonb), public.challenge_creator_get(uuid) from public, anon, authenticated;
grant execute on function public.challenge_set_questions(uuid, jsonb), public.challenge_creator_get(uuid) to authenticated;
