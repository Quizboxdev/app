-- Social channels managed from the admin: the super admin adds, edits, hides and reorders QuizBox's channels (TikTok, Instagram, Facebook, YouTube, LinkedIn, Snapchat, a WhatsApp number or channel, Telegram, X, email, a website),
-- and the "Follow QuizBox" corner of the app menu shows whatever is switched on. Ships OFF behind flags.social_channels: with the flag off, qb_social_channels() answers nothing and the app keeps showing its built-in list.
--   social_channels            the list (closed to every browser; only the functions below read or write it); seeded with the six channels the app shows today
--   qb_social_channels()       public read of the active channels (name, kind, handle, link), in order
--   qb_social_admin_list / _save / _delete / _reorder   super admin only
-- A WhatsApp number is stored as digits and becomes https://wa.me/<digits>; an email becomes mailto:; every other channel needs an https link on that platform's own site (so a typo or a look-alike address is refused).
-- Additive and idempotent. Rollback: supabase/rollback/social_channels.sql (keeps the table).
begin;

insert into public.platform_settings(key, value, description)
select 'flags.social_channels', 'false'::jsonb, 'The Follow QuizBox corner shows the channels managed in Admin > Social channels'
where not exists (select 1 from public.platform_settings p where p.key = 'flags.social_channels' and p.scope_type = 'global');

create table if not exists public.social_channels (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('tiktok', 'instagram', 'facebook', 'youtube', 'linkedin', 'snapchat', 'whatsapp', 'whatsapp_channel', 'telegram', 'x', 'email', 'website')),
  label text not null check (length(btrim(label)) between 2 and 60),
  handle text check (handle is null or length(handle) <= 80),
  target text not null check (length(target) between 3 and 300),
  url text not null check (length(url) <= 330),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_channels_order on public.social_channels (sort_order, created_at);
alter table public.social_channels enable row level security;
revoke all on public.social_channels from anon, authenticated;

-- Turns what staff typed into the link people will open, or refuses it.
create or replace function public.qb_social_link(p_kind text, p_target text) returns text language plpgsql immutable set search_path = '' as $fn$
declare t text := btrim(coalesce(p_target, '')); digits text; host text; ok boolean;
begin
  if p_kind = 'whatsapp' then
    digits := regexp_replace(t, '[^0-9]', '', 'g');
    if length(digits) not between 8 and 15 then raise exception 'QB_SOCIAL_INVALID'; end if;
    return 'https://wa.me/' || digits;
  elsif p_kind = 'email' then
    if t !~ '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$' then raise exception 'QB_SOCIAL_INVALID'; end if;
    return 'mailto:' || lower(t);
  end if;
  if length(t) > 300 or t !~* '^https://([a-z0-9-]+\.)+[a-z]{2,}(:[0-9]+)?(/[^\s<>"'']*)?$' then raise exception 'QB_SOCIAL_INVALID'; end if;
  host := lower(substring(t from '^https://([^/:]+)'));
  ok := case p_kind
      when 'tiktok' then host ~ '(^|\.)tiktok\.com$'
      when 'instagram' then host ~ '(^|\.)instagram\.com$'
      when 'facebook' then host ~ '(^|\.)(facebook\.com|fb\.com|fb\.me)$'
      when 'youtube' then host ~ '(^|\.)(youtube\.com|youtu\.be)$'
      when 'linkedin' then host ~ '(^|\.)linkedin\.com$'
      when 'snapchat' then host ~ '(^|\.)snapchat\.com$'
      when 'telegram' then host ~ '(^|\.)(t\.me|telegram\.me)$'
      when 'x' then host ~ '(^|\.)(x\.com|twitter\.com)$'
      when 'whatsapp_channel' then host ~ '(^|\.)(whatsapp\.com|wa\.me)$'
      when 'website' then true
      else false end;
  if not ok then raise exception 'QB_SOCIAL_WRONG_SITE'; end if;
  return t;
end $fn$;
revoke all on function public.qb_social_link(text, text) from public, anon, authenticated;

-- Public: the active channels, in order. Off (flag false) answers an empty list so the app keeps its built-in channels.
create or replace function public.qb_social_channels() returns jsonb language sql stable security definer set search_path = '' as $fn$
  select case when coalesce(quizbox_core.flag('flags.social_channels'), false) then
    coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'label', c.label, 'handle', c.handle, 'url', c.url) order by c.sort_order, c.created_at)
                from public.social_channels c where c.active), '[]'::jsonb)
  else '[]'::jsonb end;
$fn$;

create or replace function public.qb_social_admin_list() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object('flag', coalesce(quizbox_core.flag('flags.social_channels'), false),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'label', c.label, 'handle', c.handle, 'target', c.target, 'url', c.url, 'active', c.active, 'sort_order', c.sort_order, 'updated_at', c.updated_at)
                                       order by c.sort_order, c.created_at) from public.social_channels c), '[]'::jsonb));
end $fn$;

-- Add (no id) or change (id) one channel. p: { id?, kind, label, handle?, target, active? }
create or replace function public.qb_social_admin_save(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_kind text := btrim(coalesce(p ->> 'kind', '')); v_label text := btrim(regexp_replace(coalesce(p ->> 'label', ''), '[[:cntrl:]]', ' ', 'g'));
        v_handle text := nullif(left(btrim(regexp_replace(coalesce(p ->> 'handle', ''), '[[:cntrl:]]', ' ', 'g')), 80), ''); v_target text := btrim(coalesce(p ->> 'target', ''));
        v_active boolean := coalesce((p ->> 'active')::boolean, true); v_url text; r public.social_channels;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if length(v_label) not between 2 and 60 or v_label ~ '[<>]' or (v_handle is not null and v_handle ~ '[<>]') then raise exception 'QB_SOCIAL_INVALID'; end if;
  v_url := public.qb_social_link(v_kind, v_target);
  if v_id is null then
    if (select count(*) from public.social_channels) >= 30 then raise exception 'QB_SOCIAL_TOO_MANY'; end if;
    insert into public.social_channels(kind, label, handle, target, url, active, sort_order)
    values (v_kind, v_label, v_handle, v_target, v_url, v_active, coalesce((select max(sort_order) + 1 from public.social_channels), 1)) returning * into r;
  else
    update public.social_channels set kind = v_kind, label = v_label, handle = v_handle, target = v_target, url = v_url, active = v_active, updated_at = now() where id = v_id returning * into r;
    if r.id is null then raise exception 'QB_NOT_FOUND'; end if;
  end if;
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'label', r.label, 'url', r.url, 'active', r.active);
end $fn$;

create or replace function public.qb_social_admin_delete(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare n integer;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  delete from public.social_channels where id = p_id; get diagnostics n = row_count;
  if n = 0 then raise exception 'QB_NOT_FOUND'; end if;
  return jsonb_build_object('deleted', p_id);
end $fn$;

-- p_ids: every channel id in the order wanted (a channel not listed keeps its place after the listed ones).
create or replace function public.qb_social_admin_reorder(p_ids uuid[]) returns jsonb language plpgsql security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  update public.social_channels c set sort_order = o.n, updated_at = now() from (select id, ord::integer as n from unnest(coalesce(p_ids, '{}')) with ordinality as u(id, ord)) o where c.id = o.id;
  update public.social_channels c set sort_order = 1000 + s.rn from (select id, row_number() over (order by sort_order, created_at) as rn from public.social_channels where id <> all (coalesce(p_ids, '{}'))) s where c.id = s.id;
  return jsonb_build_object('ok', true);
end $fn$;

-- The six channels the app shows today, so switching the flag on changes nothing until staff edit the list.
insert into public.social_channels(kind, label, handle, target, url, sort_order)
select v.kind, v.label, v.handle, v.target, v.target, v.ord from (values
  ('tiktok', 'TikTok', '@quizz_box', 'https://www.tiktok.com/@quizz_box', 1),
  ('instagram', 'Instagram', '@quizz.box.solutions', 'https://www.instagram.com/quizz.box.solutions/', 2),
  ('facebook', 'Facebook', 'quizbox.solutions', 'https://www.facebook.com/quizbox.solutions/', 3),
  ('youtube', 'YouTube', '@QuizBoxsolutions', 'https://www.youtube.com/@QuizBoxsolutions', 4),
  ('linkedin', 'LinkedIn', 'QuizBox Solutions', 'https://www.linkedin.com/company/94181986', 5),
  ('snapchat', 'Snapchat', 'quizbox', 'https://www.snapchat.com/add/quizbox', 6)) as v(kind, label, handle, target, ord)
where not exists (select 1 from public.social_channels);

revoke all on function public.qb_social_channels() from public, anon, authenticated;
revoke all on function public.qb_social_admin_list() from public, anon, authenticated;
revoke all on function public.qb_social_admin_save(jsonb) from public, anon, authenticated;
revoke all on function public.qb_social_admin_delete(uuid) from public, anon, authenticated;
revoke all on function public.qb_social_admin_reorder(uuid[]) from public, anon, authenticated;
grant execute on function public.qb_social_channels() to anon, authenticated;
grant execute on function public.qb_social_admin_list() to authenticated;
grant execute on function public.qb_social_admin_save(jsonb) to authenticated;
grant execute on function public.qb_social_admin_delete(uuid) to authenticated;
grant execute on function public.qb_social_admin_reorder(uuid[]) to authenticated;

commit;
