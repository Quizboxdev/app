-- Snapshots random active bank questions (single choice) into the campaign, so later bank edits never change a running challenge.
create or replace function public.challenge_pull_bank(p_id uuid, p_subject_code text, p_grade text, p_count integer) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; have integer; added integer := 0; r record;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status <> 'DRAFT' then raise exception 'ONLY_DRAFT_EDITABLE' using errcode = '55000'; end if;
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
    insert into public.challenge_questions(campaign_id, position, question_text, options, correct_index, explanation, source_question_id)
    values (p_id, have, r.question_text, jsonb_build_array(r.option_a, r.option_b, r.option_c, r.option_d), ascii(r.ans) - 65, r.explanation, r.id);
  end loop;
  perform public.qb_challenge_audit('challenge_bank_pulled', p_id, jsonb_build_object('added', added, 'subject', p_subject_code));
  return jsonb_build_object('ok', true, 'added', added, 'total', have);
end $fn$;

create or replace function public.challenge_publish(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; have integer;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status not in ('DRAFT','PAUSED') then raise exception 'INVALID_TRANSITION' using errcode = '55000'; end if;
  select count(*) into have from public.challenge_questions where campaign_id = p_id;
  if have < c.question_count then raise exception 'NOT_ENOUGH_QUESTIONS' using errcode = '55000'; end if;
  if c.ends_at is not null and c.ends_at <= now() then raise exception 'ENDS_IN_THE_PAST' using errcode = '22023'; end if;
  update public.challenge_campaigns set status = 'LIVE', published_at = coalesce(published_at, now()), updated_at = now() where id = p_id;
  perform public.qb_challenge_event(p_id, 'campaign_published'); perform public.qb_challenge_audit('challenge_published', p_id);
  return jsonb_build_object('ok', true, 'slug', c.slug);
end $fn$;

create or replace function public.challenge_set_status(p_id uuid, p_status text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  c := public.qb_challenge_owned(p_id);
  if not ((c.status = 'LIVE' and p_status in ('PAUSED','COMPLETED')) or (c.status = 'PAUSED' and p_status in ('COMPLETED','ARCHIVED')) or (c.status in ('DRAFT','COMPLETED') and p_status = 'ARCHIVED')) then
    raise exception 'INVALID_TRANSITION' using errcode = '55000'; end if;
  update public.challenge_campaigns set status = p_status, updated_at = now() where id = p_id;
  perform public.qb_challenge_event(p_id, case p_status when 'PAUSED' then 'campaign_paused' when 'COMPLETED' then 'campaign_completed' else 'campaign_completed' end);
  perform public.qb_challenge_audit('challenge_' || lower(p_status), p_id);
  return jsonb_build_object('ok', true, 'status', p_status);
end $fn$;

create or replace function public.challenge_my_campaigns() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_challenge_creator() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(row_to_json(t) order by t.created_at desc) from (
    select c.id, c.slug, c.title, c.status, c.visibility, c.category, c.question_count, c.starts_at, c.ends_at, c.created_at,
           (select count(*) from public.challenge_questions q where q.campaign_id = c.id) as questions_loaded,
           (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = c.id and a.submitted_at is not null) as participants,
           c.access_code
      from public.challenge_campaigns c where c.owner_id = auth.uid() or public.qb_challenge_admin() order by c.created_at desc limit 200) t), '[]'::jsonb);
end $fn$;

create or replace function public.challenge_creator_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  c := public.qb_challenge_owned(p_id);
  return jsonb_build_object('campaign', to_jsonb(c),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'position', q.position, 'question_text', q.question_text, 'options', q.options,
        'correct_index', q.correct_index, 'explanation', q.explanation) order by q.position) from public.challenge_questions q where q.campaign_id = p_id), '[]'::jsonb));
end $fn$;

-- 6. Participants.
create or replace function public.challenge_start(p_slug text, p_code text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; made integer; ids uuid[]; v_att uuid; v_exp timestamptz;
begin
  if not public.qb_challenge_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found or not public.qb_challenge_live(c) then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  if c.visibility = 'PRIVATE' and c.access_code is distinct from nullif(btrim(p_code), '') and c.owner_id <> auth.uid() then raise exception 'WRONG_CODE' using errcode = '42501'; end if;
  select count(*) into made from public.challenge_attempts where campaign_id = c.id and user_id = auth.uid();
  if made >= c.max_attempts then raise exception 'NO_ATTEMPTS_LEFT' using errcode = '55000'; end if;
  if (select count(*) from public.challenge_attempts where user_id = auth.uid() and started_at > now() - interval '1 hour') >= 30 then raise exception 'RATE_LIMITED' using errcode = '53400'; end if;
  select array_agg(id) into ids from (select id from public.challenge_questions where campaign_id = c.id order by random() limit c.question_count) s;
  if ids is null or cardinality(ids) < c.question_count then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  v_exp := now() + make_interval(secs => c.time_limit_seconds);
  insert into public.challenge_attempts(campaign_id, user_id, attempt_no, question_ids, expires_at) values (c.id, auth.uid(), made + 1, ids, v_exp) returning id into v_att;
  perform public.qb_challenge_event(c.id, 'attempt_started');
  return jsonb_build_object('attempt_id', v_att, 'expires_at', v_exp, 'time_limit_seconds', c.time_limit_seconds, 'title', c.title,
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'question_text', q.question_text, 'options', q.options) order by array_position(ids, q.id))
                    from public.challenge_questions q where q.id = any(ids)));
end $fn$;
