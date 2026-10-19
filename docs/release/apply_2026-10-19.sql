-- APPLY, 19 October 2026: (1) row-level security on internal schemas, (2) public enquiry intake. Each is its own transaction and safe to run twice.

-- ============ 1. RLS on internal schemas: 20261018140000_rls_internal_schemas.sql ============
-- Defence in depth (tracker C6 part 2): switch row-level security ON for every table in the internal schemas (quizbox_*) that has it off.
-- Verified on production 18 October 2026 before writing this: the Data API exposes only "public"; the browser roles hold no privileges on these tables
-- and no usage on quizbox_factory, quizbox_sources or quizbox_private; no client-callable function reads them; the app never queries them directly.
-- So nothing changes today. With RLS on and no policy, a future grant or an exposed schema still returns no rows to a browser. Server functions
-- (SECURITY DEFINER, owned by the table owner) are unaffected: owners bypass RLS.
-- Every table switched on is written to quizbox_private.hardening_log so the rollback undoes exactly these and nothing else.
begin;

create table if not exists quizbox_private.hardening_log (
  id bigint generated always as identity primary key,
  action text not null,
  object text not null,
  at timestamptz not null default now(),
  unique (action, object)
);
alter table quizbox_private.hardening_log enable row level security;
revoke all on quizbox_private.hardening_log from public, anon, authenticated;

do $rls$
declare t record;
begin
  for t in
    select n.nspname as s, c.relname as r
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and n.nspname like 'quizbox\_%' and not c.relrowsecurity
  loop
    execute format('alter table %I.%I enable row level security', t.s, t.r);
    insert into quizbox_private.hardening_log(action, object) values ('rls_enabled', t.s || '.' || t.r) on conflict do nothing;
  end loop;
end $rls$;

commit;

-- ============ 2. Public enquiry intake: 20261018150000_public_interest_intake.sql ============
-- Public enquiry intake (owner-approved 18 October 2026: docs/proposals/public-intake-contract.md). One governed table for the five public forms
-- (SPONSOR, SME, SCHOOL, COUNTRY, CONTACT). Changes from the proposal: (1) a public wrapper for the write function, because the Data API serves only
-- "public"; (2) staff access for super admin AND support staff (sme_support); (3) a retention action (closed 24 months, spam 90 days); (4) idempotent.
-- Writes: only through the server route with the service-role key. Reads and review: staff only. No raw IP stored. Durable rate limits in the database.
begin;

create table if not exists quizbox_private.public_interest_submissions (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('SPONSOR','SME','SCHOOL','COUNTRY','CONTACT')),
  name text not null check (char_length(name) between 2 and 150),
  email text not null check (char_length(email) between 6 and 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'),
  phone text check (phone is null or phone ~ '^[0-9+() .-]{6,32}$'),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  country_name text check (country_name is null or char_length(country_name) <= 80),
  organization text check (organization is null or char_length(organization) <= 200),
  subject text check (subject is null or char_length(subject) <= 200),
  message text not null check (char_length(message) between 1 and 2000),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096),
  consent_at timestamptz not null,
  client_hash text not null check (client_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'NEW' check (status in ('NEW','IN_REVIEW','CONTACTED','CLOSED','SPAM')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  review_note text check (review_note is null or char_length(review_note) <= 1000)
);
create index if not exists public_interest_category_created on quizbox_private.public_interest_submissions(category, created_at desc);
create index if not exists public_interest_status_created on quizbox_private.public_interest_submissions(status, created_at desc);
alter table quizbox_private.public_interest_submissions enable row level security;
revoke all on quizbox_private.public_interest_submissions from public, anon, authenticated;

create table if not exists quizbox_private.intake_budgets (
  budget_key text not null check (char_length(budget_key) <= 120),
  window_start timestamptz not null,
  used integer not null check (used > 0),
  primary key (budget_key, window_start)
);
alter table quizbox_private.intake_budgets enable row level security;
revoke all on quizbox_private.intake_budgets from public, anon, authenticated;

-- Returns false once p_limit uses are recorded for the key in the current fixed window.
create or replace function quizbox_private.consume_intake_budget(p_key text, p_limit integer, p_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $fn$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_seconds) * p_seconds); n integer;
begin
  insert into quizbox_private.intake_budgets(budget_key, window_start, used) values (p_key, w, 1)
  on conflict (budget_key, window_start) do update set used = quizbox_private.intake_budgets.used + 1
  returning used into n;
  delete from quizbox_private.intake_budgets where window_start < now() - interval '2 days';
  return n <= p_limit;
end $fn$;

-- Per-category metadata allowlist: only these keys, strings only, each at most 300 characters.
create or replace function quizbox_private.intake_metadata_ok(p_category text, p_metadata jsonb)
returns boolean language sql immutable set search_path = '' as $fn$
  select jsonb_typeof(p_metadata) = 'object'
    and not exists (
      select 1 from jsonb_each(p_metadata) e
      where jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') > 300
         or e.key <> all (case p_category
              when 'SPONSOR' then array['sponsor_type','intended_audience']
              when 'SME'     then array['education_levels','professional_role','years_experience']
              when 'SCHOOL'  then array['institution_type','estimated_learners','contact_person']
              when 'COUNTRY' then array['role','curriculum']
              when 'CONTACT' then array['enquiry_type']
              else array[]::text[] end))
$fn$;

create or replace function quizbox_private.submit_public_interest(p jsonb, p_client_hash text)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare c text := upper(coalesce(p->>'category', '')); e text := lower(btrim(coalesce(p->>'email', ''))); new_id uuid;
begin
  if c not in ('SPONSOR','SME','SCHOOL','COUNTRY','CONTACT') then raise exception 'QB_INTAKE_INVALID'; end if;
  if coalesce((p->>'consent')::boolean, false) is not true then raise exception 'QB_INTAKE_CONSENT_REQUIRED'; end if;
  if not quizbox_private.intake_metadata_ok(c, coalesce(p->'metadata', '{}')) then raise exception 'QB_INTAKE_INVALID'; end if;
  if p_client_hash !~ '^[0-9a-f]{64}$' then raise exception 'QB_INTAKE_INVALID'; end if;
  -- Durable abuse limits: per client (hour/day), per email+category (day), global (hour).
  if not quizbox_private.consume_intake_budget('client:' || p_client_hash || ':h', 5, 3600)
     or not quizbox_private.consume_intake_budget('client:' || p_client_hash || ':d', 20, 86400)
     or not quizbox_private.consume_intake_budget('email:' || md5(e) || ':' || c, 3, 86400)
     or not quizbox_private.consume_intake_budget('global:h', 300, 3600) then
    raise exception 'QB_RATE_LIMITED';
  end if;
  insert into quizbox_private.public_interest_submissions(category, name, email, phone, country_code, country_name, organization, subject, message, metadata, consent_at, client_hash)
  values (c, btrim(p->>'name'), e, nullif(btrim(p->>'phone'), ''), nullif(upper(btrim(p->>'country_code')), ''), nullif(btrim(p->>'country_name'), ''),
          nullif(btrim(p->>'organization'), ''), nullif(btrim(p->>'subject'), ''), btrim(p->>'message'), coalesce(p->'metadata', '{}'), now(), p_client_hash)
  returning id into new_id;
  return new_id;
end $fn$;

-- Staff review surface. Super admin or support staff (sme_support); never anonymous, never an ordinary signed-in user.
-- Actions: list, counts, review (status and note), purge (super admin only: retention, see below).
create or replace function public.qb_admin_public_interest(p_action text, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare lim integer := least(greatest(coalesce((p_data->>'limit')::integer, 50), 1), 200); n integer;
begin
  if auth.uid() is null or not (quizbox_market.is_super() or quizbox_sme.has_capability('sme_support')) then raise exception 'SUPPORT_ACCESS_REQUIRED' using errcode = '42501'; end if;
  if p_action = 'list' then
    return coalesce((select jsonb_agg(to_jsonb(s) - 'client_hash' order by s.created_at desc) from (
      select * from quizbox_private.public_interest_submissions
      where (p_data->>'category' is null or category = upper(p_data->>'category'))
        and (p_data->>'status' is null or status = upper(p_data->>'status'))
        and (p_data->>'before' is null or created_at < (p_data->>'before')::timestamptz)
      order by created_at desc limit lim) s), '[]');
  elsif p_action = 'counts' then
    return jsonb_build_object('new', (select count(*) from quizbox_private.public_interest_submissions where status = 'NEW'),
      'in_review', (select count(*) from quizbox_private.public_interest_submissions where status = 'IN_REVIEW'),
      'total', (select count(*) from quizbox_private.public_interest_submissions));
  elsif p_action = 'review' then
    if upper(coalesce(p_data->>'status', '')) not in ('IN_REVIEW','CONTACTED','CLOSED','SPAM') then raise exception 'QB_INTAKE_INVALID'; end if;
    update quizbox_private.public_interest_submissions
       set status = upper(p_data->>'status'), reviewed_at = now(), reviewed_by = auth.uid(), review_note = left(nullif(btrim(p_data->>'note'), ''), 1000)
     where id = (p_data->>'id')::uuid;
    if not found then raise exception 'QB_NOT_FOUND'; end if;
    return jsonb_build_object('ok', true);
  elsif p_action = 'purge' then
    -- Retention (owner decision, 18 October 2026): closed enquiries are deleted after 24 months, spam after 90 days, anything else is kept.
    if not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
    delete from quizbox_private.public_interest_submissions
     where (status = 'CLOSED' and coalesce(reviewed_at, created_at) < now() - interval '24 months') or (status = 'SPAM' and created_at < now() - interval '90 days');
    get diagnostics n = row_count;
    return jsonb_build_object('deleted', n);
  end if;
  raise exception 'QB_INVALID_ACTION';
end $fn$;

-- The Next.js route calls this with the service-role key. The data API serves only "public", so the write function lives here as a thin wrapper;
-- it is executable by service_role ONLY (never anon, never authenticated), so no anonymous-callable function is added.
create or replace function public.qb_submit_public_interest(p jsonb, p_client_hash text) returns uuid
language sql security definer set search_path = '' as $fn$ select quizbox_private.submit_public_interest(p, p_client_hash) $fn$;

revoke all on function quizbox_private.consume_intake_budget(text, integer, integer), quizbox_private.intake_metadata_ok(text, jsonb),
  quizbox_private.submit_public_interest(jsonb, text) from public, anon, authenticated;
grant execute on function quizbox_private.submit_public_interest(jsonb, text) to service_role;
revoke all on function public.qb_submit_public_interest(jsonb, text) from public, anon, authenticated;
grant execute on function public.qb_submit_public_interest(jsonb, text) to service_role;
revoke all on function public.qb_admin_public_interest(text, jsonb) from public, anon;
grant execute on function public.qb_admin_public_interest(text, jsonb) to authenticated;

commit;

