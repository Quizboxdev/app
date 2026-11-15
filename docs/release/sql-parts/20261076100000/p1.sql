-- Social channels managed from the admin: the super admin adds, edits, hides and reorders QuizBox's channels (TikTok, Instagram, Facebook, YouTube, LinkedIn, Snapchat, a WhatsApp number or channel, Telegram, X, email, a website),
-- and the "Follow QuizBox" corner of the app menu shows whatever is switched on. Ships OFF behind flags.social_channels: with the flag off, qb_social_channels() answers nothing and the app keeps showing its built-in list.
--   social_channels            the list (closed to every browser; only the functions below read or write it); seeded with the six channels the app shows today
--   qb_social_channels()       public read of the active channels (name, kind, handle, link), in order
--   qb_social_admin_list / _save / _delete / _reorder   super admin only
-- A WhatsApp number is stored as digits and becomes https://wa.me/<digits>; an email becomes mailto:; every other channel needs an https link on that platform's own site (so a typo or a look-alike address is refused).
-- Additive and idempotent. Rollback: supabase/rollback/social_channels.sql (keeps the table).

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
