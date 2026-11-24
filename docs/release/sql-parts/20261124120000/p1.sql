-- Marketing posts: a page we publish inside QuizBox so the link we paste into social media, email and WhatsApp opens on quizbox.io, shows a flyer and summary in the link preview, and leads the reader to sign up.
--   marketing_posts  slug (the web name in /p/<slug>), title, summary (shown in link previews), body (simple formatting, same as Help), flyer (a stored image), draft or published
-- Everyone (visitors too) can read PUBLISHED posts; only support staff (the people who manage Help guides: super admin and support) write. The table is closed to every browser; everything goes through the functions below.
-- Flyers live in a public storage bucket (marketing-posts) so link previews on other sites can fetch them; the upload goes through the server (it checks the image first). Additive and idempotent. Rollback: supabase/rollback/marketing_posts.sql
begin;

create table if not exists public.marketing_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  title text not null check (length(btrim(title)) between 3 and 120),
  summary text not null check (length(btrim(summary)) between 10 and 300),
  body text not null check (length(body) between 50 and 60000),
  flyer_path text check (flyer_path ~ '^[0-9a-f-]{36}\.png$'),
  flyer_alt text check (length(flyer_alt) <= 200),
  state text not null default 'draft' check (state in ('draft', 'published')),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), published_at timestamptz
);
create index if not exists marketing_posts_list on public.marketing_posts (state, published_at desc);
alter table public.marketing_posts enable row level security;
revoke all on public.marketing_posts from anon, authenticated;

-- The flyer bucket. Public read (link previews need it), writes only by the server with its service key. Skipped where storage is not installed.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('marketing-posts', 'marketing-posts', true, 5242880, array['image/png'])
    on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/png'];
  end if;
end $$;

-- Reading (public): only published posts.
create or replace function public.qb_post_get(p_slug text) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('slug', p.slug, 'title', p.title, 'summary', p.summary, 'body', p.body, 'flyer_path', p.flyer_path, 'flyer_alt', p.flyer_alt, 'published_at', p.published_at, 'updated_at', p.updated_at)
    from public.marketing_posts p where p.slug = lower(btrim(coalesce(p_slug, ''))) and p.state = 'published';
$fn$;

create or replace function public.qb_post_list() returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('slug', x.slug, 'title', x.title, 'summary', x.summary, 'flyer_path', x.flyer_path, 'published_at', x.published_at) order by x.published_at desc), '[]'::jsonb)
    from (select * from public.marketing_posts where state = 'published' order by published_at desc limit 200) x;
$fn$;

-- Management: support staff only.
create or replace function public.qb_post_admin_list() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'slug', p.slug, 'title', p.title, 'state', p.state, 'flyer_path', p.flyer_path, 'published_at', p.published_at, 'updated_at', p.updated_at)
                          order by coalesce(p.published_at, p.updated_at) desc) from public.marketing_posts p), '[]'::jsonb);
end $fn$;

create or replace function public.qb_post_admin_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare p public.marketing_posts;
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  select * into p from public.marketing_posts where id = p_id;
  if p.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  return to_jsonb(p) - 'created_by' - 'updated_by';
end $fn$;

create or replace function public.qb_post_save(p_id uuid, p_slug text, p_title text, p_summary text, p_body text, p_flyer_path text, p_flyer_alt text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare p public.marketing_posts; v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  begin
    if p_id is null then
      insert into public.marketing_posts(slug, title, summary, body, flyer_path, flyer_alt, created_by, updated_by)
      values (v_slug, btrim(p_title), btrim(p_summary), p_body, nullif(btrim(p_flyer_path), ''), nullif(btrim(p_flyer_alt), ''), auth.uid(), auth.uid()) returning * into p;
    else
      update public.marketing_posts set slug = v_slug, title = btrim(p_title), summary = btrim(p_summary), body = p_body, flyer_path = nullif(btrim(p_flyer_path), ''), flyer_alt = nullif(btrim(p_flyer_alt), ''),
             updated_by = auth.uid(), updated_at = now() where id = p_id returning * into p;
      if p.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
    end if;
  exception when unique_violation then raise exception 'QB_POST_SLUG_TAKEN' using errcode = '23505';
            when check_violation then raise exception 'QB_POST_INVALID' using errcode = '22023';
  end;
  return to_jsonb(p) - 'created_by' - 'updated_by';
end $fn$;

create or replace function public.qb_post_set_state(p_id uuid, p_state text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare p public.marketing_posts;
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if p_state not in ('draft', 'published') then raise exception 'QB_POST_INVALID' using errcode = '22023'; end if;
  update public.marketing_posts set state = p_state, published_at = case when p_state = 'published' then coalesce(published_at, now()) else published_at end, updated_by = auth.uid(), updated_at = now()
   where id = p_id returning * into p;
  if p.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  perform quizbox_core.audit('post.' || p_state, 'marketing_posts', p.id, jsonb_build_object('slug', p.slug));
  return jsonb_build_object('ok', true, 'state', p.state, 'slug', p.slug);
end $fn$;

create or replace function public.qb_post_delete(p_id uuid) returns void language plpgsql security definer set search_path = '' as $fn$
declare p public.marketing_posts;
begin
  if not public.qb_support_is_staff() then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  select * into p from public.marketing_posts where id = p_id for update;
  if p.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if p.state = 'published' then raise exception 'QB_POST_UNPUBLISH_FIRST' using errcode = '55000'; end if;
  delete from public.marketing_posts where id = p.id;
  perform quizbox_core.audit('post.delete', 'marketing_posts', p.id, jsonb_build_object('slug', p.slug));
end $fn$;

revoke all on function public.qb_post_get(text), public.qb_post_list(), public.qb_post_admin_list(), public.qb_post_admin_get(uuid),
  public.qb_post_save(uuid, text, text, text, text, text, text), public.qb_post_set_state(uuid, text), public.qb_post_delete(uuid) from public, anon, authenticated;
grant execute on function public.qb_post_get(text), public.qb_post_list() to anon, authenticated, service_role;
grant execute on function public.qb_post_admin_list(), public.qb_post_admin_get(uuid), public.qb_post_save(uuid, text, text, text, text, text, text), public.qb_post_set_state(uuid, text), public.qb_post_delete(uuid) to authenticated, service_role;

commit;
notify pgrst, 'reload schema';
