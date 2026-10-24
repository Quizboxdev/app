-- QuizBox Quiz Studio: classified material, chapter sections, a reader for people who have joined, joining, templates, sponsor logos, the sponsored carousel feed and library counts.
-- Material is classified (story book, faith book, doctrine, corporate, marketing, textbook, article, other) and split into chapters; the organiser chooses which chapters participants may read.
-- The reader is for people who joined: closed during a timed round, and closed when the competition ends (or, if chosen, when it opens). The text is served in small batches, never as a file.
-- Builds on 20261021100000 to 20261027100000. Additive and idempotent. Rollback: supabase/rollback/quiz_studio.sql.


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
