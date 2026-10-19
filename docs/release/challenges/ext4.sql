create or replace function public.challenge_start(p_slug text, p_code text default null, p_stage integer default 1) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; d record; prev record; made integer; ids uuid[]; v_att uuid; v_exp timestamptz; v_stage integer := coalesce(p_stage, 1);
begin
  if not public.qb_challenge_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found or not public.qb_challenge_live(c) then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  if v_stage not between 1 and c.stage_count then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  if c.visibility = 'PRIVATE' and c.access_code is distinct from nullif(btrim(p_code), '') and c.owner_id <> auth.uid() then raise exception 'WRONG_CODE' using errcode = '42501'; end if;
  select * into d from public.qb_challenge_stage(c.id, v_stage);
  if d.starts_at is not null and d.starts_at > now() then raise exception 'STAGE_NOT_OPEN' using errcode = '55000'; end if;
  if d.ends_at is not null and d.ends_at <= now() then raise exception 'STAGE_CLOSED' using errcode = '55000'; end if;
  if v_stage > 1 then
    select * into prev from public.qb_challenge_stage(c.id, v_stage - 1);
    if not exists (select 1 from public.challenge_attempts a where a.campaign_id = c.id and a.user_id = auth.uid() and a.stage_no = v_stage - 1 and a.submitted_at is not null and not a.expired
                      and a.max_score > 0 and a.score * 100 >= prev.pass_percent * a.max_score) then raise exception 'STAGE_LOCKED' using errcode = '55000'; end if;
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

create or replace function public.challenge_leaderboard(p_slug text, p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found or c.status not in ('LIVE','PAUSED','COMPLETED') then return '[]'::jsonb; end if;
  if c.visibility = 'PRIVATE' and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()
       or exists (select 1 from public.challenge_attempts a where a.campaign_id = c.id and a.user_id = auth.uid())) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(row_to_json(t) order by t.rank) from (
    select r.rank, r.score, r.max_score, r.duration_ms, r.stages_done,
           split_part(btrim(p.full_name), ' ', 1) || case when position(' ' in btrim(p.full_name)) > 0 then ' ' || upper(left(regexp_replace(btrim(p.full_name), '^.*\s', ''), 1)) || '.' else '' end as name,
           (r.user_id = auth.uid()) as is_me
      from public.qb_challenge_ranking(c.id) r join public.profiles p on p.id = r.user_id
     order by r.rank limit least(greatest(coalesce(p_limit, 50), 1), 200)) t), '[]'::jsonb);
end $fn$;

-- 7. Content: versioned source passages. A new upload is a new version; passages are never edited, so a question's evidence cannot drift.
create or replace function public.challenge_content_add(p_campaign uuid, p_title text, p_kind text, p_source_name text, p_sha256 text, p_chunks jsonb, p_rights boolean, p_asset uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; v_asset uuid := p_asset; v_ver integer; v_vid uuid; ch jsonb; i integer := 0; total integer := 0; n integer;
begin
  c := public.qb_challenge_owned(p_campaign);
  if c.status = 'ARCHIVED' then raise exception 'INVALID_TRANSITION' using errcode = '55000'; end if;
  if jsonb_typeof(p_chunks) <> 'array' then raise exception 'INVALID_CONTENT' using errcode = '22023'; end if;
  n := jsonb_array_length(p_chunks);
  if n not between 1 and 400 then raise exception 'INVALID_CONTENT' using errcode = '22023'; end if;
  if not coalesce(p_rights, false) then raise exception 'RIGHTS_NOT_CONFIRMED' using errcode = '22023'; end if;
  if (select count(*) from public.challenge_content_assets where campaign_id = p_campaign) >= 10 and p_asset is null then raise exception 'RATE_LIMITED' using errcode = '53400'; end if;
  if v_asset is null then
    insert into public.challenge_content_assets(campaign_id, owner_id, title, kind, rights_attested) values (p_campaign, auth.uid(), btrim(p_title), coalesce(p_kind, 'book'), true) returning id into v_asset;
  elsif not exists (select 1 from public.challenge_content_assets where id = v_asset and campaign_id = p_campaign) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  update public.challenge_content_assets set current_version = current_version + 1 where id = v_asset returning current_version into v_ver;
  insert into public.challenge_content_versions(asset_id, version, source_name, sha256, char_count, chunk_count, created_by) values (v_asset, v_ver, left(p_source_name, 200), nullif(p_sha256, ''), 0, n, auth.uid()) returning id into v_vid;
  for ch in select * from jsonb_array_elements(p_chunks) loop
    i := i + 1; total := total + length(ch->>'body');
    if total > 600000 then raise exception 'INVALID_CONTENT' using errcode = '22023'; end if;
    insert into public.challenge_source_chunks(version_id, position, heading, body) values (v_vid, i, nullif(left(btrim(ch->>'heading'), 160), ''), btrim(ch->>'body'));
  end loop;
  update public.challenge_content_versions set char_count = total where id = v_vid;
  perform public.qb_challenge_event(p_campaign, 'content_added'); perform public.qb_challenge_audit('challenge_content_added', p_campaign, jsonb_build_object('asset', v_asset, 'version', v_ver, 'chunks', n));
  return jsonb_build_object('ok', true, 'asset_id', v_asset, 'version', v_ver, 'version_id', v_vid, 'chunks', n);
end $fn$;

create or replace function public.challenge_content_list(p_campaign uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform public.qb_challenge_owned(p_campaign);
  return coalesce((select jsonb_agg(jsonb_build_object('asset_id', a.id, 'title', a.title, 'kind', a.kind, 'current_version', a.current_version,
      'versions', (select jsonb_agg(jsonb_build_object('version_id', v.id, 'version', v.version, 'source_name', v.source_name, 'chunk_count', v.chunk_count, 'char_count', v.char_count, 'created_at', v.created_at) order by v.version desc)
                     from public.challenge_content_versions v where v.asset_id = a.id)) order by a.created_at)
    from public.challenge_content_assets a where a.campaign_id = p_campaign), '[]'::jsonb);
end $fn$;

