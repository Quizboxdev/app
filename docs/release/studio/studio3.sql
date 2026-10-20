create or replace function public.challenge_start(p_slug text, p_code text default null, p_stage integer default 1) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; d record; made integer; ids uuid[]; v_att uuid; v_exp timestamptz; v_stage integer := coalesce(p_stage, 1); v_clear text;
begin
  if not public.qb_challenge_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found or not public.qb_challenge_live(c) then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  if v_stage not between 1 and c.stage_count then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  if not public.qb_challenge_in_audience(c) then raise exception 'NOT_IN_AUDIENCE' using errcode = '42501'; end if;
  if c.visibility = 'PRIVATE' and c.access_code is distinct from nullif(btrim(p_code), '') and c.owner_id <> auth.uid() then raise exception 'WRONG_CODE' using errcode = '42501'; end if;
  if c.owner_id <> auth.uid() and exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid())
     and not exists (select 1 from public.challenge_participants p where p.campaign_id = c.id and p.user_id = auth.uid())
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
  insert into public.challenge_participants(campaign_id, user_id) values (c.id, auth.uid()) on conflict do nothing;
  v_exp := now() + make_interval(secs => d.time_limit_seconds);
  insert into public.challenge_attempts(campaign_id, user_id, stage_no, attempt_no, question_ids, expires_at) values (c.id, auth.uid(), v_stage, made + 1, ids, v_exp) returning id into v_att;
  perform public.qb_challenge_event(c.id, 'attempt_started');
  return jsonb_build_object('attempt_id', v_att, 'expires_at', v_exp, 'time_limit_seconds', d.time_limit_seconds, 'title', c.title, 'stage_no', v_stage, 'stage_title', d.title, 'stage_count', c.stage_count,
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'question_text', q.question_text, 'options', q.options) order by array_position(ids, q.id))
                    from public.challenge_questions q where q.id = any(ids)));
end $fn$;

-- 6. The reader. State first: OPEN | NOT_ENABLED | NOT_JOINED | NOT_IN_AUDIENCE | CLOSED_ROUND (a timed round is running) | CLOSED_ENDED | CLOSED_STARTED.
create or replace function public.qb_challenge_reader_state(c public.challenge_campaigns) returns text language sql stable security definer set search_path = '' as $fn$
  select case
    when c.owner_id = auth.uid() or public.qb_challenge_admin() then 'OPEN'
    when not c.reader_enabled or c.status = 'DRAFT' or c.moderation_state <> 'OK' then 'NOT_ENABLED'
    when c.status in ('COMPLETED','ARCHIVED') or (c.ends_at is not null and c.ends_at <= now()) then 'CLOSED_ENDED'
    when c.reader_closes = 'START' and c.starts_at is not null and c.starts_at <= now() then 'CLOSED_STARTED'
    when not public.qb_challenge_in_audience(c) then 'NOT_IN_AUDIENCE'
    when not exists (select 1 from public.challenge_participants p where p.campaign_id = c.id and p.user_id = auth.uid()) then 'NOT_JOINED'
    when exists (select 1 from public.challenge_attempts a where a.campaign_id = c.id and a.user_id = auth.uid() and a.submitted_at is null and a.expires_at > now()) then 'CLOSED_ROUND'
    else 'OPEN' end;
$fn$;

create or replace function public.challenge_material(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; st text;
begin
  if not public.qb_challenge_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  st := public.qb_challenge_reader_state(c);
  if st <> 'OPEN' then return jsonb_build_object('state', st, 'title', c.title, 'format', c.format); end if;
  return jsonb_build_object('state', st, 'title', c.title, 'format', c.format, 'closes', c.reader_closes, 'ends_at', c.ends_at,
    'documents', coalesce((select jsonb_agg(jsonb_build_object('asset_id', a.id, 'title', a.title, 'content_type', a.content_type,
        'sections', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'no', s.section_no, 'title', s.title, 'words', s.word_count) order by s.section_no)
                               from public.challenge_sections s join public.challenge_content_versions v on v.id = s.version_id where v.asset_id = a.id and v.version = a.current_version and s.reader_visible), '[]'::jsonb)) order by a.created_at)
        from public.challenge_content_assets a where a.campaign_id = c.id and a.current_version > 0), '[]'::jsonb));
end $fn$;

