create or replace function public.challenge_content_list(p_campaign uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform public.qb_challenge_owned(p_campaign);
  return coalesce((select jsonb_agg(jsonb_build_object('asset_id', a.id, 'title', a.title, 'kind', a.kind, 'content_type', a.content_type, 'current_version', a.current_version,
      'versions', (select jsonb_agg(jsonb_build_object('version_id', v.id, 'version', v.version, 'source_name', v.source_name, 'chunk_count', v.chunk_count, 'char_count', v.char_count, 'word_count', v.word_count, 'created_at', v.created_at) order by v.version desc)
                     from public.challenge_content_versions v where v.asset_id = a.id),
      'sections', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'no', s.section_no, 'title', s.title, 'words', s.word_count, 'visible', s.reader_visible) order by s.section_no)
                     from public.challenge_sections s join public.challenge_content_versions v on v.id = s.version_id where v.asset_id = a.id and v.version = a.current_version), '[]'::jsonb)) order by a.created_at)
    from public.challenge_content_assets a where a.campaign_id = p_campaign), '[]'::jsonb);
end $fn$;

-- Which chapters participants may read (the others stay out of the reader).
create or replace function public.challenge_sections_set_visible(p_campaign uuid, p_ids uuid[]) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare n integer;
begin
  perform public.qb_challenge_owned(p_campaign);
  update public.challenge_sections s set reader_visible = (s.id = any(coalesce(p_ids, '{}')))
   from public.challenge_content_versions v join public.challenge_content_assets a on a.id = v.asset_id
   where s.version_id = v.id and a.campaign_id = p_campaign and v.version = a.current_version;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'sections', n);
end $fn$;

-- Reader switches. "Closes when it opens" needs an opening time.
create or replace function public.challenge_set_reader(p_id uuid, p_enabled boolean, p_closes text default 'END') returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; v_closes text := upper(coalesce(nullif(btrim(p_closes), ''), 'END'));
begin
  c := public.qb_challenge_owned(p_id);
  if c.status = 'ARCHIVED' then raise exception 'INVALID_TRANSITION' using errcode = '55000'; end if;
  if v_closes not in ('START','END') then raise exception 'INVALID_READER' using errcode = '22023'; end if;
  if v_closes = 'START' and c.starts_at is null then raise exception 'READER_NEEDS_OPENING_TIME' using errcode = '22023'; end if;
  if p_enabled and not exists (select 1 from public.challenge_sections s join public.challenge_content_versions v on v.id = s.version_id join public.challenge_content_assets a on a.id = v.asset_id
                                where a.campaign_id = p_id and v.version = a.current_version and s.reader_visible) then raise exception 'NO_READABLE_SECTIONS' using errcode = '22023'; end if;
  update public.challenge_campaigns set reader_enabled = coalesce(p_enabled, false), reader_closes = v_closes, updated_at = now() where id = p_id;
  perform public.qb_challenge_audit('challenge_reader_set', p_id, jsonb_build_object('enabled', p_enabled, 'closes', v_closes));
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.challenge_set_targeting(p_id uuid, p_levels text[]) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; lv text[] := coalesce((select array_agg(distinct upper(x)) from unnest(coalesce(p_levels, '{}')) x), '{}');
begin
  c := public.qb_challenge_owned(p_id);
  if not (lv <@ array['PRIMARY','JHS','SHS','ADULT']::text[]) then raise exception 'INVALID_TARGET' using errcode = '22023'; end if;
  update public.challenge_campaigns set target_levels = lv, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'levels', lv);
end $fn$;

-- 4. Brand: a small logo (a PNG, JPEG or WebP picture sent as data, at most 45,000 characters) joins the name, tagline, welcome and colour.
create or replace function public.challenge_set_brand(p_id uuid, p_brand jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; k text; clean jsonb := '{}'::jsonb; v text;
begin
  c := public.qb_challenge_owned(p_id);
  if jsonb_typeof(p_brand) <> 'object' then raise exception 'INVALID_BRAND' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_brand) loop
    v := nullif(btrim(p_brand->>k), '');
    continue when v is null;
    if k = 'organiser_name' and length(v) <= 60 then clean := clean || jsonb_build_object(k, v);
    elsif k = 'tagline' and length(v) <= 120 then clean := clean || jsonb_build_object(k, v);
    elsif k = 'welcome' and length(v) <= 300 then clean := clean || jsonb_build_object(k, v);
    elsif k = 'accent' and v ~ '^#[0-9a-fA-F]{6}$' then clean := clean || jsonb_build_object(k, lower(v));
    elsif k = 'logo' and length(v) <= 45000 and v ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$' then clean := clean || jsonb_build_object(k, v);
    else raise exception 'INVALID_BRAND' using errcode = '22023'; end if;
  end loop;
  update public.challenge_campaigns set brand = clean, updated_at = now() where id = p_id;
  perform public.qb_challenge_audit('challenge_brand_set', p_id);
  return jsonb_build_object('ok', true, 'brand', clean);
end $fn$;

-- 5. Joining. A person joins (account needed; a learner's first join uses one free session) before they can read or play. Starting a round joins them too.
create or replace function public.qb_free_sessions_used(p_user uuid) returns integer language sql stable security definer set search_path = '' as $fn$
  select ((select count(*) from public.assessments a where a.owner_user_id = p_user and a.reference_type = 'SELF_PRACTICE')
        + (select count(distinct x.campaign_id) from (select campaign_id from public.challenge_participants where user_id = p_user union select campaign_id from public.challenge_attempts where user_id = p_user) x
             join public.challenge_campaigns c on c.id = x.campaign_id where c.owner_id <> p_user))::integer;
$fn$;
revoke all on function public.qb_free_sessions_used(uuid) from public, anon, authenticated;

create or replace function public.challenge_join(p_slug text, p_code text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  if not public.qb_challenge_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found or c.status <> 'LIVE' or c.moderation_state <> 'OK' or (c.ends_at is not null and c.ends_at <= now()) then raise exception 'CHALLENGE_NOT_LIVE' using errcode = 'P0002'; end if;
  if not public.qb_challenge_in_audience(c) then raise exception 'NOT_IN_AUDIENCE' using errcode = '42501'; end if;
  if c.visibility = 'PRIVATE' and c.access_code is distinct from nullif(btrim(p_code), '') and c.owner_id <> auth.uid() then raise exception 'WRONG_CODE' using errcode = '42501'; end if;
  if exists (select 1 from public.challenge_participants where campaign_id = c.id and user_id = auth.uid()) then return jsonb_build_object('ok', true, 'already', true); end if;
  if c.owner_id <> auth.uid() and exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid())
     and not exists (select 1 from public.challenge_attempts a where a.campaign_id = c.id and a.user_id = auth.uid())
     and public.qb_challenge_allowance_blocked(auth.uid()) then raise exception 'QB_FREE_ALLOWANCE_EXHAUSTED' using errcode = '55000'; end if;
  if (select count(*) from public.challenge_participants where user_id = auth.uid() and joined_at > now() - interval '1 hour') >= 60 then raise exception 'RATE_LIMITED' using errcode = '53400'; end if;
  insert into public.challenge_participants(campaign_id, user_id) values (c.id, auth.uid()) on conflict do nothing;
  return jsonb_build_object('ok', true, 'already', false);
end $fn$;

-- Starting a round also records the join (and keeps every earlier rule).
