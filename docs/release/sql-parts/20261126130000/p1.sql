-- QuizBox inter-school competitions, part 4 of 5: sponsorship quotations, invoices, payment, funding approval and the sponsor's view.
-- Fee = expected participants x the rate per participant set by an administrator (+ optional setup fee - approved discount). The rate is copied onto the quotation, so accepting locks it.
-- Sponsored registration opens only when verified payment, approved credit or a complimentary approval covers the competition's capacity. Unused places are never refunded automatically.
-- Online payment uses the existing Paystack ledger (payment_events); every attempt has its own QBS- reference and a repeated or second payment can never fund twice.
-- Sponsors see numbers only: never a learner's name, contact or individual score. Behind flags.interschool_sponsorship.
-- Builds on 20261126100000 to 20261126120000. Additive and idempotent. Rollback: supabase/rollback/interschool_billing.sql


create sequence if not exists quizbox_interschool.invoice_number;
create table if not exists quizbox_interschool.quotations (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references quizbox_interschool.competitions(id) on delete restrict,
  sponsor_user_id uuid references public.profiles(id),
  sponsor_name text not null check (length(btrim(sponsor_name)) between 2 and 140),
  version integer not null,
  participants integer not null check (participants between 1 and 200000),
  rate_minor bigint not null check (rate_minor >= 0),
  setup_fee_minor bigint not null default 0 check (setup_fee_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  discount_reason text,
  total_minor bigint not null check (total_minor >= 0),
  currency text not null default 'GHS',
  status text not null default 'ISSUED' check (status in ('ISSUED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED')),
  issued_by uuid not null references public.profiles(id),
  issued_at timestamptz not null default now(),
  valid_until timestamptz not null,
  accepted_by uuid references public.profiles(id),
  accepted_at timestamptz,
  unique (competition_id, version),
  check (total_minor = participants::bigint * rate_minor + setup_fee_minor - discount_minor),
  check (discount_minor = 0 or length(btrim(coalesce(discount_reason, ''))) >= 3)
);
create table if not exists quizbox_interschool.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('QBI-' || lpad(nextval('quizbox_interschool.invoice_number')::text, 6, '0')),
  quotation_id uuid not null unique references quizbox_interschool.quotations(id),
  competition_id uuid not null references quizbox_interschool.competitions(id) on delete restrict,
  sponsor_user_id uuid references public.profiles(id),
  sponsor_name text not null,
  participants integer not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null default 'GHS',
  status text not null default 'UNPAID' check (status in ('UNPAID', 'PAID', 'CREDIT', 'WAIVED', 'VOID', 'REFUNDED')),
  due_at timestamptz,
  paid_at timestamptz,
  paid_reference text,
  funding_note text,
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists quizbox_interschool.payment_attempts (
  reference text primary key default ('QBS-' || replace(gen_random_uuid()::text, '-', '')),
  invoice_id uuid not null references quizbox_interschool.invoices(id),
  payer_user_id uuid not null references public.profiles(id),
  amount_minor bigint not null,
  status text not null default 'initiated' check (status in ('initiated', 'successful', 'failed', 'mismatch', 'duplicate', 'refunded')),
  created_at timestamptz not null default now(), settled_at timestamptz
);
create index if not exists is_invoices_comp on quizbox_interschool.invoices(competition_id, status);
alter table quizbox_interschool.quotations enable row level security;
alter table quizbox_interschool.invoices enable row level security;
alter table quizbox_interschool.payment_attempts enable row level security;
revoke all on all tables in schema quizbox_interschool from public, anon, authenticated;
revoke all on sequence quizbox_interschool.invoice_number from public, anon, authenticated;

create or replace function quizbox_interschool.require_billing() returns void language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_interschool.require_on();
  if not coalesce(quizbox_core.flag('flags.interschool_sponsorship'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
end $fn$;

-- Funding covers the places paid for, on credit or waived. Registration for a sponsored competition is open only while that covers its capacity.
create or replace function quizbox_interschool.refresh_funding(p_competition uuid) returns void language plpgsql security definer set search_path = '' as $fn$
declare n integer;
begin
  select coalesce(sum(i.participants), 0) into n from quizbox_interschool.invoices i where i.competition_id = p_competition and i.status in ('PAID', 'CREDIT', 'WAIVED');
  update quizbox_interschool.competitions c set funded_participants = n,
    funding_cleared_at = case when n >= c.capacity then coalesce(c.funding_cleared_at, now()) end, updated_at = now() where c.id = p_competition;
end $fn$;

create or replace function public.interschool_set_rate(p_rate_minor bigint, p_setup_fee_minor bigint default 0) returns jsonb language plpgsql security definer set search_path = '' as $fn$
begin
  perform quizbox_interschool.require_on();
  if not quizbox_interschool.is_admin() then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  if p_rate_minor is null or p_rate_minor not between 0 and 1000000 or coalesce(p_setup_fee_minor, 0) not between 0 and 100000000 then raise exception 'IS_RATE_INVALID' using errcode = '22023'; end if;
  update public.platform_settings set value = to_jsonb(p_rate_minor) where key = 'interschool.rate_per_participant_minor' and scope_type = 'global';
  update public.platform_settings set value = to_jsonb(coalesce(p_setup_fee_minor, 0)) where key = 'interschool.setup_fee_minor' and scope_type = 'global';
  perform quizbox_core.audit('interschool.rate_set', 'platform_settings', null, jsonb_build_object('rate_minor', p_rate_minor, 'setup_fee_minor', p_setup_fee_minor));
  return jsonb_build_object('ok', true);
end $fn$;
