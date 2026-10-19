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

create or replace function public.challenge_submit(p_attempt uuid, p_answers jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare a public.challenge_attempts; v_score integer := 0; v_max integer; v_ms integer; item jsonb; q public.challenge_questions; v_choice integer; v_ok boolean;
begin
  select * into a from public.challenge_attempts where id = p_attempt and user_id = auth.uid() for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  v_max := cardinality(a.question_ids);
  if a.submitted_at is not null then
    return jsonb_build_object('ok', not a.expired, 'expired', a.expired, 'score', a.score, 'max_score', a.max_score, 'duration_ms', a.duration_ms, 'already_submitted', true);
  end if;
  v_ms := greatest(0, (extract(epoch from (now() - a.started_at)) * 1000)::int);
  if now() > a.expires_at + interval '20 seconds' then
    update public.challenge_attempts set submitted_at = now(), score = 0, max_score = v_max, duration_ms = v_ms, expired = true where id = a.id;
    return jsonb_build_object('ok', false, 'expired', true, 'score', 0, 'max_score', v_max);
  end if;
  if jsonb_typeof(p_answers) <> 'array' then raise exception 'INVALID_ANSWERS' using errcode = '22023'; end if;
  for item in select * from jsonb_array_elements(p_answers) loop
    select * into q from public.challenge_questions where id = (item->>'question_id')::uuid and id = any(a.question_ids);
    continue when not found;
    v_choice := (item->>'chosen_index')::int;
    v_ok := (v_choice is not null and v_choice = q.correct_index);
    insert into public.challenge_responses(attempt_id, question_id, chosen_index, is_correct) values (a.id, q.id, v_choice, v_ok) on conflict do nothing;
    if v_ok then v_score := v_score + 1; end if;
  end loop;
  insert into public.challenge_responses(attempt_id, question_id, chosen_index, is_correct)
    select a.id, qid, null, false from unnest(a.question_ids) qid on conflict do nothing;
  update public.challenge_attempts set submitted_at = now(), score = v_score, max_score = v_max, duration_ms = v_ms where id = a.id;
  perform public.qb_challenge_event(a.campaign_id, 'attempt_submitted');
  return jsonb_build_object('ok', true, 'score', v_score, 'max_score', v_max, 'duration_ms', v_ms,
    'review', (select jsonb_agg(jsonb_build_object('question_id', r.question_id, 'chosen_index', r.chosen_index, 'is_correct', r.is_correct,
        'correct_index', cq.correct_index, 'explanation', cq.explanation) order by array_position(a.question_ids, r.question_id))
                 from public.challenge_responses r join public.challenge_questions cq on cq.id = r.question_id where r.attempt_id = a.id));
end $fn$;

-- Best attempt per participant; public campaigns (and the owner of any) only. Names are first name plus last initial; managed learners never appear.
create or replace function public.challenge_leaderboard(p_slug text, p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found or c.status not in ('LIVE','PAUSED','COMPLETED') then return '[]'::jsonb; end if;
  if c.visibility = 'PRIVATE' and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()
       or exists (select 1 from public.challenge_attempts a where a.campaign_id = c.id and a.user_id = auth.uid())) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(row_to_json(t) order by t.rank) from (
    select row_number() over (order by b.score desc, b.duration_ms asc, b.submitted_at asc) as rank, b.score, b.max_score, b.duration_ms,
           split_part(btrim(p.full_name), ' ', 1) || case when position(' ' in btrim(p.full_name)) > 0 then ' ' || upper(left(regexp_replace(btrim(p.full_name), '^.*\s', ''), 1)) || '.' else '' end as name,
           (b.user_id = auth.uid()) as is_me
      from (select distinct on (a.user_id) a.* from public.challenge_attempts a
             where a.campaign_id = c.id and a.submitted_at is not null and not a.expired
             order by a.user_id, a.score desc, a.duration_ms asc) b
      join public.profiles p on p.id = b.user_id
     where not exists (select 1 from public.student_profiles sp where sp.user_id = b.user_id and sp.managed_by is not null)
     order by b.score desc, b.duration_ms asc, b.submitted_at asc limit least(greatest(coalesce(p_limit, 50), 1), 200)) t), '[]'::jsonb);
end $fn$;

create or replace function public.challenge_my_attempts() returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(row_to_json(t) order by t.started_at desc), '[]'::jsonb) from (
    select c.slug, c.title, a.attempt_no, a.score, a.max_score, a.duration_ms, a.started_at, a.submitted_at, a.expired
      from public.challenge_attempts a join public.challenge_campaigns c on c.id = a.campaign_id
     where a.user_id = auth.uid() order by a.started_at desc limit 100) t;
$fn$;

-- 7. Grants: nothing is granted to anon; participants and creators need a signed-in user (each function also checks who is calling).
revoke all on function public.challenge_public_list(integer, integer), public.challenge_public_get(text), public.challenge_create(text, text, text, text, integer, integer, integer, timestamptz, timestamptz, text, text),
  public.challenge_update(uuid, jsonb), public.challenge_set_questions(uuid, jsonb), public.challenge_pull_bank(uuid, text, text, integer), public.challenge_publish(uuid),
  public.challenge_set_status(uuid, text), public.challenge_my_campaigns(), public.challenge_creator_get(uuid), public.challenge_start(text, text), public.challenge_submit(uuid, jsonb),
  public.challenge_leaderboard(text, integer), public.challenge_my_attempts(), public.qb_challenge_active_user(), public.qb_challenge_admin(), public.qb_challenge_creator() from public, anon, authenticated;
-- Public pages read these on the server with the service role (SEO, no anonymous database permission); signed-in users may call them too.
grant execute on function public.challenge_public_list(integer, integer), public.challenge_public_get(text), public.challenge_leaderboard(text, integer) to authenticated, service_role;
