-- A parent who asks to link an existing student sees the same thing whether or not that email has an account. Until now the "waiting" list only held real accounts, and it printed the
-- address in full, so the list itself told the parent who has an account. Now every request the parent sends is noted with a masked address (a***@example.com), shown for 14 days,
-- and a request that was answered (accepted, declined or ended) is hidden. Nothing here changes who can see a child.
create schema if not exists quizbox_private;

create or replace function quizbox_private.mask_email(p_email text) returns text
language sql immutable set search_path = '' as $fn$
  select case when position('@' in coalesce(p_email, '')) > 1
    then left(lower(btrim(p_email)), 1) || '***@' || split_part(lower(btrim(p_email)), '@', 2) else 'an email' end;
$fn$;
revoke all on function quizbox_private.mask_email(text) from public, anon, authenticated;

create table if not exists public.family_link_notes (
  id uuid primary key default gen_random_uuid(),
  parent_user_id uuid not null references public.profiles(id) on delete cascade,
  masked_label text not null check (char_length(masked_label) between 3 and 240),
  created_at timestamptz not null default now()
);
create index if not exists family_link_notes_parent_idx on public.family_link_notes(parent_user_id, created_at desc);
alter table public.family_link_notes enable row level security;
revoke all on public.family_link_notes from public, anon, authenticated;

create or replace function public.qb_family_note_link_request(p_email text) returns void
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); addr text := lower(btrim(coalesce(p_email, ''))); lbl text;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if exists (select 1 from public.profiles where id = uid and lower(role::text) = 'student') then raise exception 'QB_FAMILY_NOT_ADULT' using errcode = '42501'; end if;
  if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(addr) > 200 then return; end if;
  lbl := quizbox_private.mask_email(addr);
  if (select count(*) from public.family_link_notes where parent_user_id = uid and created_at > now() - interval '1 day') >= 20 then return; end if;
  if exists (select 1 from public.family_link_notes where parent_user_id = uid and masked_label = lbl and created_at > now() - interval '14 days') then return; end if;
  insert into public.family_link_notes(parent_user_id, masked_label) values (uid, lbl);
end $fn$;

create or replace function public.qb_family_pending_requests() returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('label', m.masked_label, 'created_at', m.created_at) order by m.created_at desc), '[]'::jsonb)
    from (
      select u.masked_label, min(u.created_at) as created_at
        from (
          select n.masked_label, n.created_at from public.family_link_notes n where n.parent_user_id = auth.uid() and n.created_at > now() - interval '14 days'
          union all
          select quizbox_private.mask_email(r.label), r.created_at from public.account_relationships r
           where r.source_user_id = auth.uid() and r.family_workspace_id is not null and r.status = 'requested' and r.label like '%@%'
        ) u
       where not exists (
         select 1 from public.account_relationships r2
          where r2.source_user_id = auth.uid() and r2.family_workspace_id is not null and r2.status <> 'requested' and r2.label like '%@%'
            and quizbox_private.mask_email(r2.label) = u.masked_label and r2.created_at >= u.created_at - interval '1 minute')
       group by u.masked_label
    ) m;
$fn$;
revoke all on function public.qb_family_note_link_request(text), public.qb_family_pending_requests() from public, anon;
grant execute on function public.qb_family_note_link_request(text), public.qb_family_pending_requests() to authenticated;
