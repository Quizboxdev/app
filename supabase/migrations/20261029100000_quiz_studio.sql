-- QuizBox Quiz Studio: classified material, chapter sections, a reader for people who have joined, joining, templates, sponsor logos, the sponsored carousel feed and library counts.
-- Material is classified (story book, faith book, doctrine, corporate, marketing, textbook, article, other) and split into chapters; the organiser chooses which chapters participants may read.
-- The reader is for people who joined: closed during a timed round, and closed when the competition ends (or, if chosen, when it opens). The text is served in small batches, never as a file.
-- Builds on 20261021100000 to 20261027100000. Additive and idempotent. Rollback: supabase/rollback/quiz_studio.sql.
begin;

-- 1. Columns and tables.
alter table public.challenge_campaigns
  add column if not exists target_levels text[] not null default '{}' check (target_levels <@ array['PRIMARY','JHS','SHS','ADULT']::text[]),
  add column if not exists reader_enabled boolean not null default false,
  add column if not exists reader_closes text not null default 'END' check (reader_closes in ('START','END')),
  add column if not exists cloned_from uuid references public.challenge_campaigns(id) on delete set null;
alter table public.challenge_content_assets
  add column if not exists content_type text not null default 'other' check (content_type in ('story_book','faith_book','doctrine','corporate','marketing','textbook','article','other'));
alter table public.challenge_content_versions add column if not exists word_count integer not null default 0;

create table if not exists public.challenge_sections (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.challenge_content_versions(id) on delete cascade,
  section_no integer not null,
  title text not null check (length(btrim(title)) between 1 and 160),
  first_position integer not null, last_position integer not null check (last_position >= first_position),
  word_count integer not null default 0,
  reader_visible boolean not null default true,
  unique (version_id, section_no)
);
create table if not exists public.challenge_participants (
  campaign_id uuid not null references public.challenge_campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);
create index if not exists challenge_participants_user on public.challenge_participants(user_id);
create table if not exists public.challenge_reads (
  id bigint generated always as identity primary key,
  user_id uuid not null, campaign_id uuid not null, section_id uuid not null, read_at timestamptz not null default now()
);
create index if not exists challenge_reads_user_time on public.challenge_reads(user_id, read_at);
alter table public.challenge_sections enable row level security;
alter table public.challenge_participants enable row level security;
alter table public.challenge_reads enable row level security;
revoke all on public.challenge_sections, public.challenge_participants, public.challenge_reads from anon, authenticated, public;

-- 2. Adding material: a content type, and the chapter sections found in the document (positions of passages). Replaces the earlier signature.
drop function if exists public.challenge_content_add(uuid, text, text, text, text, jsonb, boolean, uuid);
create or replace function public.challenge_content_add(p_campaign uuid, p_title text, p_kind text, p_source_name text, p_sha256 text, p_chunks jsonb, p_rights boolean, p_asset uuid default null,
  p_content_type text default null, p_sections jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; v_asset uuid := p_asset; v_ver integer; v_vid uuid; ch jsonb; sc jsonb; i integer := 0; total integer := 0; words integer := 0; n integer; k integer := 0;
        a1 integer; a2 integer; last_end integer := 0; w integer;
begin
  c := public.qb_challenge_owned(p_campaign);
  if c.status = 'ARCHIVED' then raise exception 'INVALID_TRANSITION' using errcode = '55000'; end if;
  if jsonb_typeof(p_chunks) <> 'array' then raise exception 'INVALID_CONTENT' using errcode = '22023'; end if;
  n := jsonb_array_length(p_chunks);
  if n not between 1 and 400 then raise exception 'INVALID_CONTENT' using errcode = '22023'; end if;
  if not coalesce(p_rights, false) then raise exception 'RIGHTS_NOT_CONFIRMED' using errcode = '22023'; end if;
  if p_content_type is not null and p_content_type not in ('story_book','faith_book','doctrine','corporate','marketing','textbook','article','other') then raise exception 'INVALID_CONTENT' using errcode = '22023'; end if;
  if p_sections is not null and (jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) > 80) then raise exception 'INVALID_CONTENT' using errcode = '22023'; end if;
  if (select count(*) from public.challenge_content_assets where campaign_id = p_campaign) >= 5 and p_asset is null then raise exception 'RATE_LIMITED' using errcode = '53400'; end if;
  if v_asset is null then
    insert into public.challenge_content_assets(campaign_id, owner_id, title, kind, rights_attested, content_type) values (p_campaign, auth.uid(), btrim(p_title), coalesce(p_kind, 'book'), true, coalesce(p_content_type, 'other')) returning id into v_asset;
  elsif not exists (select 1 from public.challenge_content_assets where id = v_asset and campaign_id = p_campaign) then raise exception 'NOT_FOUND' using errcode = 'P0002';
  elsif p_content_type is not null then update public.challenge_content_assets set content_type = p_content_type where id = v_asset; end if;
  update public.challenge_content_assets set current_version = current_version + 1 where id = v_asset returning current_version into v_ver;
  insert into public.challenge_content_versions(asset_id, version, source_name, sha256, char_count, chunk_count, created_by) values (v_asset, v_ver, left(p_source_name, 200), nullif(p_sha256, ''), 0, n, auth.uid()) returning id into v_vid;
  for ch in select * from jsonb_array_elements(p_chunks) loop
    i := i + 1; total := total + length(ch->>'body');
    if total > 600000 then raise exception 'INVALID_CONTENT' using errcode = '22023'; end if;
    words := words + coalesce(array_length(regexp_split_to_array(btrim(ch->>'body'), '\s+'), 1), 0);
    insert into public.challenge_source_chunks(version_id, position, heading, body) values (v_vid, i, nullif(left(btrim(ch->>'heading'), 160), ''), btrim(ch->>'body'));
  end loop;
  update public.challenge_content_versions set char_count = total, word_count = words where id = v_vid;
  -- Chapters: the sections sent by the app (contiguous runs of passages), or the whole document as one section.
  if p_sections is null or jsonb_array_length(p_sections) = 0 then p_sections := jsonb_build_array(jsonb_build_object('title', left(btrim(p_title), 160), 'first', 1, 'last', n)); end if;
  for sc in select * from jsonb_array_elements(p_sections) loop
    k := k + 1; a1 := (sc->>'first')::int; a2 := (sc->>'last')::int;
    if a1 is null or a2 is null or a1 < 1 or a2 > n or a2 < a1 or a1 <= last_end then raise exception 'INVALID_CONTENT' using errcode = '22023'; end if;
    last_end := a2;
    select coalesce(sum(coalesce(array_length(regexp_split_to_array(btrim(x.body), '\s+'), 1), 0)), 0) into w from public.challenge_source_chunks x where x.version_id = v_vid and x.position between a1 and a2;
    insert into public.challenge_sections(version_id, section_no, title, first_position, last_position, word_count) values (v_vid, k, left(coalesce(nullif(btrim(sc->>'title'), ''), 'Section ' || k), 160), a1, a2, w);
  end loop;
  perform public.qb_challenge_event(p_campaign, 'content_added'); perform public.qb_challenge_audit('challenge_content_added', p_campaign, jsonb_build_object('asset', v_asset, 'version', v_ver, 'chunks', n, 'sections', k));
  return jsonb_build_object('ok', true, 'asset_id', v_asset, 'version', v_ver, 'version_id', v_vid, 'chunks', n, 'sections', k, 'words', words);
end $fn$;

-- 3. The organiser's view of their material: type, size and chapters (with which are readable).
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

create or replace function public.challenge_material_read(p_slug text, p_section uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; s public.challenge_sections; a public.challenge_content_assets; v public.challenge_content_versions; nm text; prev_id uuid; next_id uuid;
begin
  if not public.qb_challenge_active_user() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if public.qb_challenge_reader_state(c) <> 'OPEN' then raise exception 'READER_CLOSED' using errcode = '55000'; end if;
  select s2.* into s from public.challenge_sections s2 join public.challenge_content_versions v2 on v2.id = s2.version_id join public.challenge_content_assets a2 on a2.id = v2.asset_id
   where s2.id = p_section and a2.campaign_id = c.id and v2.version = a2.current_version and (s2.reader_visible or c.owner_id = auth.uid() or public.qb_challenge_admin());
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if (select count(*) from public.challenge_reads where user_id = auth.uid() and read_at > now() - interval '1 hour') >= 300 then raise exception 'RATE_LIMITED' using errcode = '53400'; end if;
  insert into public.challenge_reads(user_id, campaign_id, section_id) values (auth.uid(), c.id, s.id);
  if random() < 0.02 then delete from public.challenge_reads where read_at < now() - interval '2 days'; end if;
  select * into v from public.challenge_content_versions where id = s.version_id;
  select * into a from public.challenge_content_assets where id = v.asset_id;
  select s3.id into prev_id from public.challenge_sections s3 where s3.version_id = s.version_id and s3.section_no < s.section_no and (s3.reader_visible or c.owner_id = auth.uid() or public.qb_challenge_admin()) order by s3.section_no desc limit 1;
  select s3.id into next_id from public.challenge_sections s3 where s3.version_id = s.version_id and s3.section_no > s.section_no and (s3.reader_visible or c.owner_id = auth.uid() or public.qb_challenge_admin()) order by s3.section_no limit 1;
  select split_part(btrim(p.full_name), ' ', 1) || case when position(' ' in btrim(p.full_name)) > 0 then ' ' || upper(left(regexp_replace(btrim(p.full_name), '^.*\s', ''), 1)) || '.' else '' end into nm from public.profiles p where p.id = auth.uid();
  return jsonb_build_object('document', a.title, 'content_type', a.content_type, 'section_id', s.id, 'no', s.section_no, 'title', s.title, 'words', s.word_count, 'prev', prev_id, 'next', next_id, 'reader', nm,
    'ends_at', c.ends_at, 'passages', coalesce((select jsonb_agg(jsonb_build_object('position', ch.position, 'heading', ch.heading, 'body', ch.body) order by ch.position)
        from public.challenge_source_chunks ch where ch.version_id = s.version_id and ch.position between s.first_position and least(s.last_position, s.first_position + 79)), '[]'::jsonb));
end $fn$;
revoke all on function public.qb_challenge_reader_state(public.challenge_campaigns) from public, anon, authenticated;

-- 7. Templates: copy a campaign (questions, rounds, prizes, look, material and its chapters) into a new draft with no audience and no dates, so it can be run again for someone else.
create or replace function public.challenge_clone(p_id uuid, p_title text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c public.challenge_campaigns; base text; s text; n integer := 0; v_new uuid; v_title text; v_code text; a record; v_asset uuid; v_ver uuid; v_limit integer;
begin
  c := public.qb_challenge_owned(p_id);
  v_limit := case when exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role::text) = 'student') then 5 else 20 end;
  if (select count(*) from public.challenge_campaigns where owner_id = auth.uid() and created_at > now() - interval '1 day') >= v_limit then raise exception 'RATE_LIMITED' using errcode = '53400'; end if;
  v_title := left(coalesce(nullif(btrim(p_title), ''), 'Copy of ' || c.title), 120);
  base := left(regexp_replace(regexp_replace(lower(v_title), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), 50);
  if length(base) < 3 then base := lower(c.format); end if; s := base;
  while exists (select 1 from public.challenge_campaigns where slug = s) loop n := n + 1; s := base || '-' || n; end loop;
  v_code := case when c.visibility = 'PRIVATE' then upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)) end;
  insert into public.challenge_campaigns(owner_id, slug, title, summary, category, visibility, access_code, question_count, time_limit_seconds, max_attempts, reward_text, brand, stage_count, format,
                                         target_levels, reader_enabled, reader_closes, cloned_from)
  values (auth.uid(), s, v_title, c.summary, c.category, c.visibility, v_code, c.question_count, c.time_limit_seconds, c.max_attempts, c.reward_text, c.brand, c.stage_count, c.format,
          c.target_levels, c.reader_enabled, 'END', c.id) returning id into v_new;
  insert into public.challenge_stages(campaign_id, stage_no, title, question_count, time_limit_seconds, pass_percent, advance_top_n) select v_new, stage_no, title, question_count, time_limit_seconds, pass_percent, null from public.challenge_stages where campaign_id = c.id;
  insert into public.challenge_prizes(campaign_id, rank_from, rank_to, kind, title, details) select v_new, rank_from, rank_to, kind, title, details from public.challenge_prizes where campaign_id = c.id;
  drop table if exists qb_clone_map; create temporary table qb_clone_map(old_id uuid, new_id uuid) on commit drop;
  for a in select * from public.challenge_content_assets where campaign_id = c.id and current_version > 0 order by created_at loop
    insert into public.challenge_content_assets(campaign_id, owner_id, title, kind, rights_attested, current_version, content_type) values (v_new, auth.uid(), a.title, a.kind, true, 1, a.content_type) returning id into v_asset;
    insert into public.challenge_content_versions(asset_id, version, source_name, sha256, char_count, chunk_count, word_count, created_by)
      select v_asset, 1, source_name, sha256, char_count, chunk_count, word_count, auth.uid() from public.challenge_content_versions where asset_id = a.id and version = a.current_version returning id into v_ver;
    insert into public.challenge_source_chunks(version_id, position, heading, body) select v_ver, ch.position, ch.heading, ch.body from public.challenge_source_chunks ch
      join public.challenge_content_versions ov on ov.id = ch.version_id where ov.asset_id = a.id and ov.version = a.current_version;
    insert into qb_clone_map select oc.id, nc.id from public.challenge_source_chunks oc join public.challenge_content_versions ov on ov.id = oc.version_id and ov.asset_id = a.id and ov.version = a.current_version
      join public.challenge_source_chunks nc on nc.version_id = v_ver and nc.position = oc.position;
    insert into public.challenge_sections(version_id, section_no, title, first_position, last_position, word_count, reader_visible)
      select v_ver, sc.section_no, sc.title, sc.first_position, sc.last_position, sc.word_count, sc.reader_visible from public.challenge_sections sc join public.challenge_content_versions ov on ov.id = sc.version_id where ov.asset_id = a.id and ov.version = a.current_version;
  end loop;
  insert into public.challenge_questions(campaign_id, position, question_text, options, correct_index, explanation, source_question_id, stage_no, source_chunk_id, source_quote)
    select v_new, q.position, q.question_text, q.options, q.correct_index, q.explanation, q.source_question_id, q.stage_no, m.new_id, case when m.new_id is not null then q.source_quote end
      from public.challenge_questions q left join qb_clone_map m on m.old_id = q.source_chunk_id where q.campaign_id = c.id;
  perform public.qb_challenge_audit('challenge_cloned', v_new, jsonb_build_object('from', c.id));
  return jsonb_build_object('id', v_new, 'slug', s, 'format', c.format);
end $fn$;

-- 8. Card and list: material facts and the target levels (no text, ever).
create or replace function public.challenge_public_get(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare c public.challenge_campaigns;
begin
  select * into c from public.challenge_campaigns where slug = lower(btrim(p_slug));
  if not found then return null; end if;
  if c.moderation_state = 'TAKEN_DOWN' and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()) then return null; end if;
  if c.visibility = 'PRIVATE' and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()) then
    return jsonb_build_object('slug', c.slug, 'title', c.title, 'format', c.format, 'private', true, 'live', public.qb_challenge_live(c), 'brand', c.brand);
  end if;
  if c.status not in ('LIVE','PAUSED','COMPLETED') and not (coalesce(c.owner_id = auth.uid(), false) or public.qb_challenge_admin()) then return null; end if;
  return jsonb_build_object('slug', c.slug, 'title', c.title, 'summary', c.summary, 'category', c.category, 'format', c.format, 'visibility', c.visibility, 'status', c.status,
    'audience', case when c.audience_class_id is not null then 'CLASS' when c.audience_institution_id is not null then 'SCHOOL' else 'ANYONE' end,
    'target_levels', to_jsonb(c.target_levels),
    'live', public.qb_challenge_live(c), 'starts_at', c.starts_at, 'ends_at', c.ends_at, 'question_count', c.question_count,
    'time_limit_seconds', c.time_limit_seconds, 'max_attempts', c.max_attempts, 'reward_text', c.reward_text, 'brand', c.brand, 'stage_count', c.stage_count,
    'material', case when c.reader_enabled then jsonb_build_object('closes', c.reader_closes,
        'types', coalesce((select jsonb_agg(distinct a.content_type) from public.challenge_content_assets a where a.campaign_id = c.id and a.current_version > 0), '[]'::jsonb),
        'documents', (select count(*) from public.challenge_content_assets a where a.campaign_id = c.id and a.current_version > 0),
        'sections', (select count(*) from public.challenge_sections s join public.challenge_content_versions v on v.id = s.version_id join public.challenge_content_assets a on a.id = v.asset_id
                      where a.campaign_id = c.id and v.version = a.current_version and s.reader_visible)) end,
    'stages', coalesce((select jsonb_agg(jsonb_build_object('stage_no', s.stage_no, 'title', s.title, 'question_count', s.question_count, 'time_limit_seconds', s.time_limit_seconds, 'pass_percent', s.pass_percent,
                          'advance_top_n', s.advance_top_n, 'starts_at', s.starts_at, 'ends_at', s.ends_at) order by s.stage_no)
                          from public.challenge_stages s where s.campaign_id = c.id), '[]'::jsonb),
    'prizes', coalesce((select jsonb_agg(jsonb_build_object('rank_from', p.rank_from, 'rank_to', p.rank_to, 'kind', p.kind, 'title', p.title, 'details', p.details) order by p.rank_from)
                          from public.challenge_prizes p where p.campaign_id = c.id), '[]'::jsonb),
    'finalized', c.finalized_at is not null,
    'participants', (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = c.id and a.submitted_at is not null));
end $fn$;

-- 9. Sponsored quizzes for the carousel and the sidebar: live, public, branded with a logo, made by a sponsor, admin or owner (or marked as sponsored), aimed at everyone, and matching the viewer's level.
create or replace function public.challenge_featured(p_limit integer default 8, p_level text default null) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select c.slug, c.title, c.summary, c.format, c.category, c.brand, c.stage_count, c.question_count, c.reader_enabled as has_material,
           (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = c.id and a.submitted_at is not null) as participants
      from public.challenge_campaigns c
     where c.visibility = 'PUBLIC' and public.qb_challenge_live(c) and c.audience_class_id is null and c.audience_institution_id is null and c.brand ? 'logo'
       and (c.category = 'sponsor' or exists (select 1 from public.profiles p where p.id = c.owner_id and lower(p.role::text) in ('sponsor','admin','owner')))
       and (p_level is null or c.target_levels = '{}' or upper(p_level) = any(c.target_levels))
     order by coalesce(c.published_at, c.created_at) desc
     limit least(greatest(coalesce(p_limit, 8), 1), 12)) t;
$fn$;

-- 10. How much material is hosted, by type (counts only; private campaigns and drafts are left out).
create or replace function public.challenge_library_stats() returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object(
    'documents', coalesce(sum(n), 0),
    'by_type', coalesce(jsonb_object_agg(content_type, n), '{}'::jsonb))
  from (select a.content_type, count(*)::int as n from public.challenge_content_assets a join public.challenge_campaigns c on c.id = a.campaign_id
         where a.current_version > 0 and c.status in ('LIVE','PAUSED','COMPLETED') and c.visibility <> 'PRIVATE' and c.moderation_state = 'OK' group by a.content_type) x;
$fn$;

-- 11. My list also shows the logo flag, whether material is set, and where a copy came from.
create or replace function public.challenge_my_campaigns() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_challenge_creator() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(row_to_json(t) order by t.created_at desc) from (
    select c.id, c.slug, c.title, c.status, c.visibility, c.category, c.format, c.stage_count, c.question_count, c.starts_at, c.ends_at, c.created_at, c.cloned_from,
           (c.audience_class_id is not null or c.audience_institution_id is not null) as has_audience, c.brand ? 'logo' as has_logo, c.reader_enabled,
           (select count(*) from public.challenge_questions q where q.campaign_id = c.id) as questions_loaded,
           (select count(distinct a.user_id) from public.challenge_attempts a where a.campaign_id = c.id and a.submitted_at is not null) as participants,
           c.access_code
      from public.challenge_campaigns c where c.owner_id = auth.uid() or public.qb_challenge_admin() order by c.created_at desc limit 200) t), '[]'::jsonb);
end $fn$;

-- 12. Grants.
revoke all on function public.challenge_content_add(uuid, text, text, text, text, jsonb, boolean, uuid, text, jsonb), public.challenge_content_list(uuid), public.challenge_sections_set_visible(uuid, uuid[]),
  public.challenge_set_reader(uuid, boolean, text), public.challenge_set_targeting(uuid, text[]), public.challenge_set_brand(uuid, jsonb), public.challenge_join(text, text), public.challenge_start(text, text, integer),
  public.challenge_material(text), public.challenge_material_read(text, uuid), public.challenge_clone(uuid, text), public.challenge_public_get(text), public.challenge_featured(integer, text),
  public.challenge_library_stats(), public.challenge_my_campaigns() from public, anon, authenticated;
grant execute on function public.challenge_content_add(uuid, text, text, text, text, jsonb, boolean, uuid, text, jsonb), public.challenge_content_list(uuid), public.challenge_sections_set_visible(uuid, uuid[]),
  public.challenge_set_reader(uuid, boolean, text), public.challenge_set_targeting(uuid, text[]), public.challenge_set_brand(uuid, jsonb), public.challenge_join(text, text), public.challenge_start(text, text, integer),
  public.challenge_material(text), public.challenge_material_read(text, uuid), public.challenge_clone(uuid, text), public.challenge_my_campaigns() to authenticated;
grant execute on function public.challenge_public_get(text), public.challenge_featured(integer, text), public.challenge_library_stats() to authenticated, service_role;

commit;
notify pgrst, 'reload schema';
