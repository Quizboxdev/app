-- PROPOSAL ONLY — NOT A MIGRATION. Do not copy into supabase/migrations until the owner approves
-- docs/proposals/public-intake-contract.md. Intended filename once approved:
--   supabase/migrations/2026100XXXXXXX_public_interest_intake.sql
--
-- One governed intake for the five public forms (SPONSOR, SME, SCHOOL, COUNTRY, CONTACT).
-- Security model:
--   * Table lives in quizbox_private (not exposed through PostgREST); RLS on; no grants to
--     public/anon/authenticated.
--   * Writes only through quizbox_private.submit_public_interest(), executable by service_role only.
--     The Next.js route app/api/public/intake/route.ts calls it server-side; the service-role key
--     never reaches the browser.
--   * Reads/review only through public.qb_admin_public_interest(), gated by quizbox_market.is_super().
--   * Rate limits are durable (per hashed client, per email+category, global). No raw IP is stored.
begin;

create table quizbox_private.public_interest_submissions (
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
create index public_interest_category_created on quizbox_private.public_interest_submissions(category, created_at desc);
create index public_interest_status_created on quizbox_private.public_interest_submissions(status, created_at desc);
alter table quizbox_private.public_interest_submissions enable row level security;
revoke all on quizbox_private.public_interest_submissions from public, anon, authenticated;

create table quizbox_private.intake_budgets (
  budget_key text not null check (char_length(budget_key) <= 120),
  window_start timestamptz not null,
  used integer not null check (used > 0),
  primary key (budget_key, window_start)
);
alter table quizbox_private.intake_budgets enable row level security;
revoke all on quizbox_private.intake_budgets from public, anon, authenticated;

-- Returns false once p_limit uses are recorded for the key in the current fixed window.
create function quizbox_private.consume_intake_budget(p_key text, p_limit integer, p_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_seconds) * p_seconds); n integer;
begin
  insert into quizbox_private.intake_budgets(budget_key, window_start, used) values (p_key, w, 1)
  on conflict (budget_key, window_start) do update set used = quizbox_private.intake_budgets.used + 1
  returning used into n;
  delete from quizbox_private.intake_budgets where window_start < now() - interval '2 days';
  return n <= p_limit;
end $$;

-- Per-category metadata allowlist: only these keys, strings only, each at most 300 characters.
create function quizbox_private.intake_metadata_ok(p_category text, p_metadata jsonb)
returns boolean language sql immutable set search_path = '' as $$
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
$$;

create function quizbox_private.submit_public_interest(p jsonb, p_client_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
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
end $$;

-- Staff review surface. Super-admin only; no anonymous or ordinary authenticated access.
create function public.qb_admin_public_interest(p_action text, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare lim integer := least(greatest(coalesce((p_data->>'limit')::integer, 50), 1), 200);
begin
  if not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if p_action = 'list' then
    return coalesce((select jsonb_agg(to_jsonb(s) - 'client_hash' order by s.created_at desc) from (
      select * from quizbox_private.public_interest_submissions
      where (p_data->>'category' is null or category = upper(p_data->>'category'))
        and (p_data->>'status' is null or status = upper(p_data->>'status'))
        and (p_data->>'before' is null or created_at < (p_data->>'before')::timestamptz)
      order by created_at desc limit lim) s), '[]');
  elsif p_action = 'review' then
    if upper(coalesce(p_data->>'status', '')) not in ('IN_REVIEW','CONTACTED','CLOSED','SPAM') then raise exception 'QB_INTAKE_INVALID'; end if;
    update quizbox_private.public_interest_submissions
       set status = upper(p_data->>'status'), reviewed_at = now(), reviewed_by = auth.uid(), review_note = left(nullif(btrim(p_data->>'note'), ''), 1000)
     where id = (p_data->>'id')::uuid;
    if not found then raise exception 'QB_NOT_FOUND'; end if;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'QB_INVALID_ACTION';
end $$;

revoke all on function quizbox_private.consume_intake_budget(text, integer, integer), quizbox_private.intake_metadata_ok(text, jsonb),
  quizbox_private.submit_public_interest(jsonb, text) from public, anon, authenticated;
grant execute on function quizbox_private.submit_public_interest(jsonb, text) to service_role;
revoke all on function public.qb_admin_public_interest(text, jsonb) from public, anon;
grant execute on function public.qb_admin_public_interest(text, jsonb) to authenticated;

commit;

-- Rollback (proposal): supabase/rollback/public_interest_intake.sql
-- begin;
-- drop function if exists public.qb_admin_public_interest(text, jsonb);
-- drop function if exists quizbox_private.submit_public_interest(jsonb, text);
-- drop function if exists quizbox_private.intake_metadata_ok(text, jsonb);
-- drop function if exists quizbox_private.consume_intake_budget(text, integer, integer);
-- drop table if exists quizbox_private.intake_budgets;
-- drop table if exists quizbox_private.public_interest_submissions;  -- refuse if rows exist in production
-- commit;
