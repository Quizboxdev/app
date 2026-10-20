create or replace function public.qb_my_access() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare lim integer := public.qb_access_free_limit(); used integer; learner boolean; sub boolean;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select exists (select 1 from public.student_profiles where user_id = auth.uid()) into learner;
  sub := public.qb_has_subscription(auth.uid());
  used := public.qb_free_sessions_used(auth.uid());
  return jsonb_build_object('gated', learner and lim is not null, 'free_limit', lim, 'used', used,
    'remaining', case when lim is null then null else greatest(lim - used, 0) end, 'subscribed', sub,
    'exhausted', learner and public.qb_free_allowance_exhausted(auth.uid()),
    'subscription_until', (select max(valid_until) from public.learner_subscriptions s where s.user_id = auth.uid() and s.status = 'active' and s.valid_until > now()));
end $fn$;
-- Safe to call whether or not the free-allowance migration is present (then nobody is blocked).
create or replace function public.qb_challenge_allowance_blocked(p_user uuid) returns boolean language plpgsql stable security definer set search_path = '' as $fn$
declare r boolean := false;
begin
  if to_regprocedure('public.qb_free_allowance_exhausted(uuid)') is null then return false; end if;
  execute 'select public.qb_free_allowance_exhausted($1)' into r using p_user;
  return coalesce(r, false);
end $fn$;
revoke all on function public.qb_free_sessions_used(uuid), public.qb_free_allowance_exhausted(uuid), public.qb_challenge_allowance_blocked(uuid) from public, anon, authenticated;
revoke all on function public.qb_my_access() from public, anon;
grant execute on function public.qb_my_access() to authenticated;

-- 7. Joining: audience, the free allowance on a first join, and round progression.
create or replace function public.challenge_start(p_slug text, p_code text default null, p_stage integer default 1) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; d record; made integer; ids uuid[]; v_att uuid; v_exp timestamptz; v_stage integer := coalesce(p_stage, 1); v_clear text;
begin
  if not public.qb_challenge_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found or not public.qb_challenge_live(c) then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  if v_stage not between 1 and c.stage_count then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  if not public.qb_challenge_in_audience(c) then raise exception 'NOT_IN_AUDIENCE' using errcode = '42501'; end if;
  if c.visibility = 'PRIVATE' and c.access_code is distinct from nullif(btrim(p_code), '') and c.owner_id <> auth.uid() then raise exception 'WRONG_CODE' using errcode = '42501'; end if;
  -- First join by a learner uses one free session; people already in keep going through the rounds.
  if c.owner_id <> auth.uid() and exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid())
     and not exists (select 1 from public.challenge_attempts a where a.campaign_id = c.id and a.user_id = auth.uid())
     and public.qb_challenge_allowance_blocked(auth.uid()) then raise exception 'QB_FREE_ALLOWANCE_EXHAUSTED' using errcode = '55000'; end if;
  select * into d from public.qb_challenge_stage(c.id, v_stage);
  if d.starts_at is not null and d.starts_at > now() then raise exception 'STAGE_NOT_OPEN' using errcode = '55000'; end if;
  if d.ends_at is not null and d.ends_at <= now() then raise exception 'STAGE_CLOSED' using errcode = '55000'; end if;
  if v_stage > 1 then
    v_clear := public.qb_challenge_cleared(c.id, v_stage - 1, auth.uid());
    if v_clear = 'WAITING' then raise exception 'ROUND_STILL_RUNNING' using errcode = '55000';
    elsif v_clear = 'OUT' then raise exception 'NOT_THROUGH' using errcode = '55000';
    elsif v_clear <> 'YES' then raise exception 'STAGE_LOCKED' using errcode = '55000'; end if;
  end if;
  select count(*) into made from public.challenge_attempts where campaign_id = c.id and user_id = auth.uid() and stage_no = v_stage;
  if made >= c.max_attempts then raise exception 'NO_ATTEMPTS_LEFT' using errcode = '55000'; end if;
  if (select count(*) from public.challenge_attempts where user_id = auth.uid() and started_at > now() - interval '1 hour') >= 30 then raise exception 'RATE_LIMITED' using errcode = '53400'; end if;
  select array_agg(id) into ids from (select id from public.challenge_questions where campaign_id = c.id and stage_no = v_stage order by random() limit d.question_count) s;
  if ids is null or cardinality(ids) < d.question_count then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  v_exp := now() + make_interval(secs => d.time_limit_seconds);
  insert into public.challenge_attempts(campaign_id, user_id, stage_no, attempt_no, question_ids, expires_at) values (c.id, auth.uid(), v_stage, made + 1, ids, v_exp) returning id into v_att;
  perform public.qb_challenge_event(c.id, 'attempt_started');
  return jsonb_build_object('attempt_id', v_att, 'expires_at', v_exp, 'time_limit_seconds', d.time_limit_seconds, 'title', c.title, 'stage_no', v_stage, 'stage_title', d.title, 'stage_count', c.stage_count,
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'question_text', q.question_text, 'options', q.options) order by array_position(ids, q.id))
                    from public.challenge_questions q where q.id = any(ids)));
end $fn$;

-- 8. Publishing tells a class or school it has something new; the leaderboard stays inside the audience.
