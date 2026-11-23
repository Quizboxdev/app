-- The Help video library: short how-to videos kept in YouTube and shown on the Help guides they explain, so people find their way around and QuizBox's own channel earns the views.
--   help_videos       title, one-line summary, the YouTube video id, who it is for, draft or published, and two counters (plays inside QuizBox, clicks through to YouTube)
--   help_video_links  which guides a video belongs to (a video can sit on several guides; deleting or renaming a guide keeps the links in step)
-- Everyone (visitors too) can read published videos of published guides; only support staff (the same people who manage the guides) write. Both tables are closed to every browser;
-- everything goes through the functions below. Counters are written by the server only, after it has limited each device. Additive and idempotent. Rollback: supabase/rollback/help_videos.sql.
begin;

create table if not exists public.help_videos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 3 and 120),
  summary text not null default '' check (length(summary) <= 240),
  youtube_id text not null unique check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  audiences text[] not null default array['everyone'] check (cardinality(audiences) >= 1 and audiences <@ array['everyone', 'student', 'teacher', 'school', 'sponsor']::text[]),
  duration_seconds integer check (duration_seconds is null or duration_seconds between 1 and 7200),
  sort_order integer not null default 100,
  state text not null default 'draft' check (state in ('draft', 'published')),
  plays integer not null default 0 check (plays >= 0), outbound integer not null default 0 check (outbound >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), published_at timestamptz
);
create index if not exists help_videos_list on public.help_videos (state, sort_order);

create table if not exists public.help_video_links (
  video_id uuid not null references public.help_videos(id) on delete cascade,
  article_slug text not null references public.help_articles(slug) on update cascade on delete cascade,
  sort_order integer not null default 100,
  primary key (video_id, article_slug)
);
create index if not exists help_video_links_slug on public.help_video_links (article_slug);
alter table public.help_videos enable row level security;
alter table public.help_video_links enable row level security;
revoke all on public.help_videos, public.help_video_links from anon, authenticated;

-- Reading. The videos of one published guide, and the published videos for a role (a visitor with no role sees all of them).
create or replace function public.qb_help_videos_for(p_slug text) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'title', v.title, 'summary', v.summary, 'youtube_id', v.youtube_id, 'duration_seconds', v.duration_seconds) order by l.sort_order, v.sort_order, v.title), '[]'::jsonb)
    from public.help_video_links l
    join public.help_videos v on v.id = l.video_id and v.state = 'published'
    join public.help_articles a on a.slug = l.article_slug and a.state = 'published'
   where l.article_slug = lower(btrim(coalesce(p_slug, '')));
$fn$;

create or replace function public.qb_help_videos_list(p_audience text default null) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'title', v.title, 'summary', v.summary, 'youtube_id', v.youtube_id, 'duration_seconds', v.duration_seconds,
           'guide', (select jsonb_build_object('slug', a.slug, 'title', a.title) from public.help_video_links l join public.help_articles a on a.slug = l.article_slug and a.state = 'published'
                      where l.video_id = v.id order by l.sort_order, a.title limit 1)) order by v.sort_order, v.title), '[]'::jsonb)
    from public.help_videos v
   where v.state = 'published' and (p_audience is null or p_audience not in ('student', 'teacher', 'school', 'sponsor') or 'everyone' = any (v.audiences) or p_audience = any (v.audiences));
$fn$;

-- Counters: written by the server after it has limited each device (one play and one click per video per device per hour).
create or replace function public.qb_help_video_track(p_id uuid, p_event text) returns void language plpgsql security definer set search_path = '' as $fn$
begin
  if p_event <> 'play' then raise exception 'QB_HELP_INVALID' using errcode = '22023'; end if;
  update public.help_videos set plays = plays + 1 where id = p_id and state = 'published';
end $fn$;

-- The click through to YouTube: gives back the video id (nothing for a draft or an unknown video) and counts the click unless the server says this device has already been counted this hour.
create or replace function public.qb_help_video_outbound(p_id uuid, p_count boolean default true) returns text language plpgsql security definer set search_path = '' as $fn$
declare y text;
begin
  update public.help_videos set outbound = outbound + (case when coalesce(p_count, true) then 1 else 0 end) where id = p_id and state = 'published' returning youtube_id into y;
  return y;
end $fn$;

-- Management: support staff only.
create or replace function public.qb_help_video_admin_list() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'title', v.title, 'summary', v.summary, 'youtube_id', v.youtube_id, 'audiences', v.audiences, 'duration_seconds', v.duration_seconds,
      'sort_order', v.sort_order, 'state', v.state, 'plays', v.plays, 'outbound', v.outbound, 'updated_at', v.updated_at,
      'slugs', coalesce((select jsonb_agg(l.article_slug order by l.sort_order, l.article_slug) from public.help_video_links l where l.video_id = v.id), '[]'::jsonb)) order by v.sort_order, v.title) from public.help_videos v), '[]'::jsonb);
end $fn$;

create or replace function public.qb_help_video_save(p_id uuid, p_title text, p_summary text, p_youtube_id text, p_audiences text[], p_sort integer, p_duration integer, p_slugs text[]) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare v public.help_videos; s text[] := coalesce((select array_agg(distinct lower(btrim(x))) from unnest(coalesce(p_slugs, array[]::text[])) x where btrim(x) <> ''), array[]::text[]);
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if cardinality(s) > 12 or (select count(*) from public.help_articles where slug = any (s)) <> cardinality(s) then raise exception 'QB_HELP_INVALID' using errcode = '22023'; end if;
  begin
    if p_id is null then
      insert into public.help_videos(title, summary, youtube_id, audiences, sort_order, duration_seconds, updated_by)
      values (btrim(p_title), btrim(coalesce(p_summary, '')), btrim(p_youtube_id), coalesce(p_audiences, array['everyone']), coalesce(p_sort, 100), p_duration, auth.uid()) returning * into v;
    else
      update public.help_videos set title = btrim(p_title), summary = btrim(coalesce(p_summary, '')), youtube_id = btrim(p_youtube_id), audiences = coalesce(p_audiences, audiences),
             sort_order = coalesce(p_sort, sort_order), duration_seconds = p_duration, updated_by = auth.uid(), updated_at = now() where id = p_id returning * into v;
      if v.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
    end if;
  exception when unique_violation then raise exception 'QB_VIDEO_TAKEN' using errcode = '23505';
            when check_violation then raise exception 'QB_HELP_INVALID' using errcode = '22023';
  end;
  delete from public.help_video_links where video_id = v.id and not (article_slug = any (s));
  insert into public.help_video_links(video_id, article_slug, sort_order)
    select v.id, x.slug, x.n::integer * 10 from unnest(s) with ordinality as x(slug, n) on conflict (video_id, article_slug) do update set sort_order = excluded.sort_order;
  return to_jsonb(v) || jsonb_build_object('slugs', to_jsonb(s));
end $fn$;

create or replace function public.qb_help_video_set_state(p_id uuid, p_state text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v public.help_videos;
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if p_state not in ('draft', 'published') then raise exception 'QB_HELP_INVALID' using errcode = '22023'; end if;
  update public.help_videos set state = p_state, published_at = case when p_state = 'published' then coalesce(published_at, now()) else published_at end, updated_by = auth.uid(), updated_at = now()
   where id = p_id returning * into v;
  if v.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  perform quizbox_core.audit('help.video.' || p_state, 'help_videos', v.id, jsonb_build_object('youtube_id', v.youtube_id));
  return jsonb_build_object('ok', true, 'state', v.state);
end $fn$;

create or replace function public.qb_help_video_delete(p_id uuid) returns void language plpgsql security definer set search_path = '' as $fn$
declare v public.help_videos;
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  select * into v from public.help_videos where id = p_id for update;
  if v.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.state = 'published' then raise exception 'QB_HELP_UNPUBLISH_FIRST' using errcode = '55000'; end if;
  delete from public.help_videos where id = v.id;
  perform quizbox_core.audit('help.video.delete', 'help_videos', v.id, jsonb_build_object('youtube_id', v.youtube_id));
end $fn$;

revoke all on function public.qb_help_videos_for(text), public.qb_help_videos_list(text), public.qb_help_video_track(uuid, text), public.qb_help_video_outbound(uuid, boolean), public.qb_help_video_admin_list(),
  public.qb_help_video_save(uuid, text, text, text, text[], integer, integer, text[]), public.qb_help_video_set_state(uuid, text), public.qb_help_video_delete(uuid) from public, anon, authenticated;
grant execute on function public.qb_help_videos_for(text), public.qb_help_videos_list(text) to anon, authenticated, service_role;
grant execute on function public.qb_help_video_admin_list(), public.qb_help_video_save(uuid, text, text, text, text[], integer, integer, text[]), public.qb_help_video_set_state(uuid, text), public.qb_help_video_delete(uuid) to authenticated;
grant execute on function public.qb_help_video_track(uuid, text), public.qb_help_video_outbound(uuid, boolean) to service_role;

commit;
notify pgrst, 'reload schema';
