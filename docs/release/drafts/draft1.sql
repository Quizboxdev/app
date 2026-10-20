-- Draft holder for unfinished work (a challenge or competition being set up, a sponsored competition, a practice set, an assignment).
-- The screens save what a person has typed as they go, so leaving the page by mistake loses nothing. A draft lives for 24 hours after its last change (never more than
-- 72 hours in all), is warned about in the app (bell, phone push, and email by the app) two hours before it is deleted, and is then removed by the sweep.
-- One draft per person, kind and scope; at most 20 per person; at most 100 KB each. Young learners (managed accounts) never get drafts.
-- Additive and idempotent. Rollback: supabase/rollback/activity_drafts.sql (it deletes the drafts: they are temporary by design).

create table if not exists public.activity_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('challenge','competition','sponsor_competition','practice','assignment','other')),
  scope_key text not null default 'new' check (scope_key ~ '^[A-Za-z0-9_-]{1,64}$'),
  title text not null default '' check (length(title) <= 120),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 100000),
  path text check (path is null or path ~ '^/[A-Za-z0-9/_\-?=&.]*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  warned_at timestamptz,
  unique (user_id, kind, scope_key)
);
create index if not exists activity_drafts_expiry on public.activity_drafts(expires_at);
alter table public.activity_drafts enable row level security;
revoke all on public.activity_drafts from anon, authenticated, public;

create or replace function public.qb_draft_allowed() returns boolean language sql stable security definer set search_path = '' as $fn$
  select auth.uid() is not null
    and exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.status::text) = 'active')
    and not exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid() and sp.managed_by is not null);
$fn$;

-- Save (or replace) the draft for this kind and scope. Every save restarts the 24 hours, up to 72 hours from the first save, and clears any earlier warning.
create or replace function public.qb_draft_save(p_kind text, p_key text, p_title text, p_payload jsonb, p_path text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare v_key text := coalesce(nullif(btrim(p_key), ''), 'new'); r public.activity_drafts;
begin
  if not public.qb_draft_allowed() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if not exists (select 1 from public.activity_drafts where user_id = auth.uid() and kind = p_kind and scope_key = v_key)
     and (select count(*) from public.activity_drafts where user_id = auth.uid() and expires_at > now()) >= 20 then
    raise exception 'TOO_MANY_DRAFTS' using errcode = '53400';
  end if;
  insert into public.activity_drafts(user_id, kind, scope_key, title, payload, path, expires_at)
  values (auth.uid(), p_kind, v_key, left(coalesce(p_title, ''), 120), coalesce(p_payload, '{}'::jsonb), nullif(btrim(p_path), ''), now() + interval '24 hours')
  on conflict (user_id, kind, scope_key) do update
    set title = excluded.title, payload = excluded.payload, path = excluded.path, updated_at = now(), warned_at = null,
        expires_at = least(now() + interval '24 hours', public.activity_drafts.created_at + interval '72 hours')
  returning * into r;
  return jsonb_build_object('id', r.id, 'expires_at', r.expires_at);
end $fn$;

create or replace function public.qb_draft_get(p_kind text, p_key text default 'new') returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('id', d.id, 'title', d.title, 'payload', d.payload, 'path', d.path, 'updated_at', d.updated_at, 'expires_at', d.expires_at)
    from public.activity_drafts d
   where d.user_id = auth.uid() and d.kind = p_kind and d.scope_key = coalesce(nullif(btrim(p_key), ''), 'new') and d.expires_at > now();
$fn$;

create or replace function public.qb_draft_list() returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'scope_key', d.scope_key, 'title', d.title, 'path', d.path, 'updated_at', d.updated_at, 'expires_at', d.expires_at) order by d.expires_at), '[]'::jsonb)
    from public.activity_drafts d where d.user_id = auth.uid() and d.expires_at > now();
$fn$;

create or replace function public.qb_draft_delete(p_kind text, p_key text default 'new') returns void language sql security definer set search_path = '' as $fn$
  delete from public.activity_drafts where user_id = auth.uid() and kind = p_kind and scope_key = coalesce(nullif(btrim(p_key), ''), 'new');
$fn$;
create or replace function public.qb_draft_discard(p_id uuid) returns void language sql security definer set search_path = '' as $fn$
  delete from public.activity_drafts where id = p_id and user_id = auth.uid();
$fn$;

-- "Keep it": another 24 hours (never beyond 72 hours from the first save), and the warning can fire again.
create or replace function public.qb_draft_keep(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare r public.activity_drafts;
begin
  update public.activity_drafts set expires_at = least(now() + interval '24 hours', created_at + interval '72 hours'), warned_at = null
   where id = p_id and user_id = auth.uid() and expires_at > now() returning * into r;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', r.id, 'expires_at', r.expires_at);
end $fn$;

-- The sweep (service role, run every few minutes by the app's scheduled route): delete what has expired and warn, once, about drafts with two hours or less left.
-- The warning goes into the person's notifications (bell and phone push). It returns who to email so the app can send the email.
create or replace function public.qb_drafts_sweep() returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare purged integer; d record; warned jsonb := '[]'::jsonb; label text; can_notify boolean := to_regprocedure('public.qb_challenge_notify(uuid,text,text,text,text)') is not null;
begin
  delete from public.activity_drafts where expires_at <= now();
  get diagnostics purged = row_count;
  for d in
    update public.activity_drafts x set warned_at = now()
     where x.warned_at is null and x.expires_at > now() and x.expires_at <= now() + interval '2 hours'
    returning x.id, x.user_id, x.kind, x.title, x.path, x.expires_at
  loop
    label := case d.kind when 'challenge' then 'challenge' when 'competition' then 'competition' when 'sponsor_competition' then 'sponsored competition' when 'practice' then 'practice set' when 'assignment' then 'assignment' else 'work' end;
    if can_notify then
      execute 'select public.qb_challenge_notify($1, $2, $3, $4, $5)' using d.user_id, 'Your unfinished ' || label || ' will be deleted soon',
        'Your unfinished ' || label || coalesce(' "' || nullif(d.title, '') || '"', '') || ' will be deleted in about 2 hours. Open it to keep working.', coalesce(d.path, '/drafts'), 'system';
    end if;
    warned := warned || jsonb_build_array(jsonb_build_object('id', d.id, 'user_id', d.user_id, 'kind', d.kind, 'label', label, 'title', d.title, 'path', coalesce(d.path, '/drafts'), 'expires_at', d.expires_at,
      'email', (select p.email from public.profiles p where p.id = d.user_id)));
  end loop;
  return jsonb_build_object('purged', purged, 'warned', warned);
end $fn$;

revoke all on function public.qb_draft_allowed(), public.qb_draft_save(text, text, text, jsonb, text), public.qb_draft_get(text, text), public.qb_draft_list(), public.qb_draft_delete(text, text),
  public.qb_draft_discard(uuid), public.qb_draft_keep(uuid), public.qb_drafts_sweep() from public, anon, authenticated;
grant execute on function public.qb_draft_save(text, text, text, jsonb, text), public.qb_draft_get(text, text), public.qb_draft_list(), public.qb_draft_delete(text, text),
  public.qb_draft_discard(uuid), public.qb_draft_keep(uuid) to authenticated;
grant execute on function public.qb_drafts_sweep() to service_role;

notify pgrst, 'reload schema';

