-- Policies as a managed section (Terms, Privacy, Refunds, Cookies) with versions, company details as variables, and acknowledgement.
--   company_details        the facts policies use as {{company_name}} {{support_email}} ... (entered once in Admin)
--   policy_documents       one row per document (slug, title, required = must be accepted after sign-up and after a material change)
--   policy_versions        text, summary, effective date; draft -> published -> superseded; a published version can never be edited
--   policy_acceptances     who accepted which version, when, by whom (a teacher for a child account), with a fingerprint of the text
-- Publishing is refused while the text uses a {{variable}} that has no value, so nothing goes live with a blank fact. Owner and super admin manage; everyone can read the published text.
-- Writes only through the checked functions below. Additive and idempotent. Rollback: supabase/rollback/policy_cms.sql.


create table if not exists public.company_details (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null, value text not null default '' check (length(value) <= 500),
  sort_order integer not null default 100, updated_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);
insert into public.company_details(key, label, value, sort_order) values
  ('company_name', 'Company name', 'QuizBox Solutions', 10),
  ('country', 'Country of registration', 'Ghana', 20),
  ('registration_number', 'Company registration number', '', 30),
  ('registered_address', 'Registered office address', '', 40),
  ('support_email', 'Support email address', '', 50),
  ('dpo_contact', 'Data protection contact (name and email)', '', 60),
  ('dpc_registration', 'Data Protection Commission registration number', '', 70),
  ('data_location', 'Where data is stored (for example: the European Union and the United States)', '', 80),
  ('retention_tickets', 'How long support tickets and files are kept', '', 90),
  ('retention_inactive', 'How long inactive accounts are kept', '', 100),
  ('retention_attempts', 'How long quiz attempts and results are kept', '', 110)
on conflict (key) do nothing;

create table if not exists public.policy_documents (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 40),
  title text not null check (length(btrim(title)) between 3 and 80),
  required boolean not null default true,
  sort_order integer not null default 100, active boolean not null default true, created_at timestamptz not null default now()
);
insert into public.policy_documents(slug, title, required, sort_order) values
  ('terms', 'Terms of Use', true, 10), ('privacy', 'Privacy Notice', true, 20), ('refunds', 'Refund Policy', false, 30), ('cookies', 'Cookie and Storage Notice', false, 40)
on conflict (slug) do nothing;

create table if not exists public.policy_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.policy_documents(id) on delete restrict,
  version_no integer not null check (version_no >= 1),
  body text not null default '' check (length(body) <= 200000),
  summary text not null default '' check (length(summary) <= 500),
  effective_at timestamptz, requires_reack boolean not null default false,
  state text not null default 'draft' check (state in ('draft', 'published', 'superseded')),
  fingerprint text, created_by uuid references public.profiles(id), created_at timestamptz not null default now(),
  published_by uuid references public.profiles(id), published_at timestamptz,
  unique (document_id, version_no)
);
create unique index if not exists policy_versions_one_draft on public.policy_versions(document_id) where state = 'draft';
create unique index if not exists policy_versions_one_published on public.policy_versions(document_id) where state = 'published';

create table if not exists public.policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  version_id uuid not null references public.policy_versions(id) on delete restrict,
  accepted_at timestamptz not null default now(),
  accepted_by uuid references public.profiles(id) on delete set null,
  fingerprint text not null,
  unique (user_id, version_id)
);
create index if not exists policy_acceptances_user on public.policy_acceptances(user_id);

alter table public.company_details enable row level security;
alter table public.policy_documents enable row level security;
alter table public.policy_versions enable row level security;
alter table public.policy_acceptances enable row level security;
revoke all on public.company_details, public.policy_documents, public.policy_versions, public.policy_acceptances from anon, authenticated;

-- A published version is evidence of what people accepted: its text can never change, and it can never be deleted. Only draft -> published and published -> superseded are allowed.
create or replace function public.qb_trg_policy_version_guard() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'DELETE' then
    if old.state <> 'draft' then raise exception 'QB_POLICY_IMMUTABLE' using errcode = '55000'; end if;
    return old;
  end if;
  if old.state <> 'draft' then
    if old.state = 'published' and new.state = 'superseded' and new.body = old.body and new.summary = old.summary and new.fingerprint is not distinct from old.fingerprint then return new; end if;
    raise exception 'QB_POLICY_IMMUTABLE' using errcode = '55000';
  end if;
  return new;
end $fn$;
drop trigger if exists qb_policy_version_guard on public.policy_versions;
create trigger qb_policy_version_guard before update or delete on public.policy_versions for each row execute function public.qb_trg_policy_version_guard();
revoke all on function public.qb_trg_policy_version_guard() from public, anon, authenticated;

-- Variables: {{key}} in the text is replaced by the company detail of that name. Internal helpers, not callable from a browser.
create or replace function public.qb_policy_missing(p_body text) returns text[] language sql stable security definer set search_path = '' as $fn$
  select coalesce(array_agg(distinct m[1] order by m[1]), '{}') from regexp_matches(coalesce(p_body, ''), '\{\{([a-z][a-z0-9_]*)\}\}', 'g') as m
   where not exists (select 1 from public.company_details c where c.key = m[1] and btrim(c.value) <> '');
$fn$;
create or replace function public.qb_policy_resolve(p_body text) returns text language plpgsql stable security definer set search_path = '' as $fn$
declare r record; t text := coalesce(p_body, '');
begin
  for r in select key, value from public.company_details where btrim(value) <> '' loop t := replace(t, '{{' || r.key || '}}', btrim(r.value)); end loop;
  return t;
end $fn$;
revoke all on function public.qb_policy_missing(text), public.qb_policy_resolve(text) from public, anon, authenticated;
