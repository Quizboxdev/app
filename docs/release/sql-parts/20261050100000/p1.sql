begin;

-- Additive storage-backed image records. Direct client access is denied; authenticated APIs validate role/ownership first.
create table if not exists public.subject_visuals (
  subject_slug text primary key check (subject_slug ~ '^[a-z0-9-]+$'),
  discovery_path text not null,
  mobile_path text not null,
  discovery_width integer not null check (discovery_width between 1 and 960),
  discovery_height integer not null check (discovery_height between 1 and 600),
  discovery_bytes integer not null check (discovery_bytes between 1 and 150000),
  mobile_width integer not null check (mobile_width between 1 and 640),
  mobile_height integer not null check (mobile_height between 1 and 640),
  mobile_bytes integer not null check (mobile_bytes between 1 and 110000),
  focal_x smallint not null default 50 check (focal_x between 0 and 100),
  focal_y smallint not null default 50 check (focal_y between 0 and 100),
  alt_text text not null default '' check (length(alt_text) <= 300),
  asset_version text not null,
  asset_status text not null default 'pending' check (asset_status in ('approved','concept','pending','rejected')),
  rights_status text not null default 'pending' check (rights_status in ('cleared','pending','refused')),
  rights_note text not null default '' check (length(rights_note) <= 500),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.subject_visuals enable row level security;
revoke all on public.subject_visuals from public, anon, authenticated;

insert into public.platform_settings(key, scope_type, value, description)
values ('flags.q_insignia_backend_subject_photos', 'global', 'false'::jsonb, 'Serve approved subject images uploaded through QuizBox administration')
on conflict (key, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000')) do nothing;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('sponsor-branding', 'sponsor-branding', true, 24576, array['image/webp'])
on conflict (id) do update set public = true, file_size_limit = 24576, allowed_mime_types = array['image/webp'];
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('subject-photos', 'subject-photos', false, 260000, array['image/webp'])
on conflict (id) do update set public = false, file_size_limit = 260000, allowed_mime_types = array['image/webp'];

-- Keep historic base64 logos working; new logo values are exact object paths scoped to the campaign.
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
    elsif k = 'logo' and ((length(v) <= 45000 and v ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$') or v ~ ('^campaigns/' || p_id::text || '/[0-9a-f-]{36}\.webp$')) then clean := clean || jsonb_build_object(k, v);
    else raise exception 'INVALID_BRAND' using errcode = '22023'; end if;
  end loop;
  update public.challenge_campaigns set brand = clean, updated_at = now() where id = p_id;
  perform public.qb_challenge_audit('challenge_brand_set', p_id);
  return jsonb_build_object('ok', true, 'brand', clean);
end $fn$;

commit;
notify pgrst, 'reload schema';
