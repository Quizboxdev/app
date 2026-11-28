-- QuizBox inter-school competitions, part 4 of 5: sponsorship quotations, invoices, payment, funding approval and the sponsor's view.
-- Fee = expected participants x the rate per participant set by an administrator (+ optional setup fee - approved discount). The rate is copied onto the quotation, so accepting locks it.
-- Sponsored registration opens only when verified payment, approved credit or a complimentary approval covers the competition's capacity. Unused places are never refunded automatically.
-- Online payment uses the existing Paystack ledger (payment_events); every attempt has its own QBS- reference and a repeated or second payment can never fund twice.
-- Sponsors see numbers only: never a learner's name, contact or individual score. Behind flags.interschool_sponsorship.
-- Builds on 20261126100000 to 20261126120000. Additive and idempotent. Rollback: supabase/rollback/interschool_billing.sql
begin;

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

-- A quotation. A sponsor can ask for one at the standard rate; only an administrator can set the number of participants freely for another sponsor, change the setup fee or give a discount.
create or replace function public.interschool_quote(p_competition uuid, p_participants integer default null, p_sponsor uuid default null, p_sponsor_name text default null, p_discount_minor bigint default 0,
  p_discount_reason text default null, p_setup_fee_minor bigint default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; admin boolean; rate bigint; setup bigint; n integer; v integer; total bigint; q quizbox_interschool.quotations; sponsor uuid; v_name text; funded boolean;
begin
  perform quizbox_interschool.require_billing();
  c := quizbox_interschool.managed(p_competition, true);
  admin := quizbox_interschool.is_admin();
  if c.funding <> 'SPONSORED' then raise exception 'IS_NOT_SPONSORED' using errcode = '55000'; end if;
  if c.status in ('COMPLETED', 'CANCELLED') then raise exception 'IS_COMPETITION_CLOSED' using errcode = '55000'; end if;
  if not admin and (c.organiser_kind <> 'SPONSOR' or coalesce(p_discount_minor, 0) <> 0 or p_setup_fee_minor is not null or (p_sponsor is not null and p_sponsor <> auth.uid())) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  rate := nullif(quizbox_core.setting('interschool.rate_per_participant_minor') #>> '{}', '')::bigint;
  if rate is null then raise exception 'IS_RATE_NOT_SET' using errcode = '55000'; end if;
  funded := c.funded_participants > 0;
  -- by default quote the places not yet funded: the whole expected number first, then only the increase
  n := coalesce(p_participants, case when funded then greatest(greatest(c.expected_participants, c.capacity) - c.funded_participants, 0) else c.expected_participants end);
  if n < 1 then raise exception 'IS_NOTHING_TO_QUOTE' using errcode = '55000'; end if;
  if not admin and n < (case when funded then 1 else c.expected_participants end) then raise exception 'IS_QUOTE_BELOW_EXPECTED' using errcode = '22023'; end if;
  setup := coalesce(p_setup_fee_minor, case when funded then 0 else coalesce(nullif(quizbox_core.setting('interschool.setup_fee_minor') #>> '{}', '')::bigint, 0) end);
  total := n::bigint * rate + setup - coalesce(p_discount_minor, 0);
  if total < 0 then raise exception 'IS_DISCOUNT_TOO_LARGE' using errcode = '22023'; end if;
  sponsor := coalesce(p_sponsor, case when c.organiser_kind = 'SPONSOR' then c.organiser_user_id end);
  if sponsor is not null and not quizbox_interschool.approved_sponsor(sponsor) then raise exception 'IS_SPONSOR_NOT_APPROVED' using errcode = '55000'; end if;
  v_name := coalesce(nullif(btrim(p_sponsor_name), ''), c.sponsor_name, (select p.full_name from public.profiles p where p.id = sponsor));
  if v_name is null then raise exception 'IS_SPONSOR_NAME_REQUIRED' using errcode = '22023'; end if;
  update quizbox_interschool.quotations set status = 'SUPERSEDED' where competition_id = c.id and status = 'ISSUED' and sponsor_name = v_name;
  select coalesce(max(version), 0) + 1 into v from quizbox_interschool.quotations where competition_id = c.id;
  insert into quizbox_interschool.quotations(competition_id, sponsor_user_id, sponsor_name, version, participants, rate_minor, setup_fee_minor, discount_minor, discount_reason, total_minor, issued_by, valid_until)
  values (c.id, sponsor, v_name, v, n, rate, setup, coalesce(p_discount_minor, 0), nullif(btrim(p_discount_reason), ''), total, auth.uid(), now() + interval '30 days') returning * into q;
  perform quizbox_interschool.notify(sponsor, 'Sponsorship quotation', c.title || ': a quotation for ' || n || ' participants is ready.', '/interschool/sponsor');
  perform quizbox_interschool.audit('quoted', c.id, jsonb_build_object('quotation', q.id, 'participants', n, 'total_minor', total, 'discount_minor', q.discount_minor));
  return to_jsonb(q);
end $fn$;

create or replace function public.interschool_decide_quote(p_quote uuid, p_accept boolean) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare q quizbox_interschool.quotations; inv quizbox_interschool.invoices;
begin
  perform quizbox_interschool.require_billing();
  select * into q from quizbox_interschool.quotations where id = p_quote for update;
  if q.id is null or not (q.sponsor_user_id = auth.uid() or quizbox_interschool.is_admin()) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  if q.status = 'ACCEPTED' and p_accept then select * into inv from quizbox_interschool.invoices where quotation_id = q.id; return to_jsonb(inv); end if;
  if q.status <> 'ISSUED' then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  if not p_accept then update quizbox_interschool.quotations set status = 'REJECTED' where id = q.id; perform quizbox_interschool.audit('quote_rejected', q.competition_id, jsonb_build_object('quotation', q.id)); return jsonb_build_object('ok', true); end if;
  if q.valid_until <= now() then raise exception 'IS_QUOTE_EXPIRED' using errcode = '55000'; end if;
  update quizbox_interschool.quotations set status = 'ACCEPTED', accepted_by = auth.uid(), accepted_at = now() where id = q.id;
  insert into quizbox_interschool.invoices(quotation_id, competition_id, sponsor_user_id, sponsor_name, participants, amount_minor, currency, due_at, status, funding_note)
  values (q.id, q.competition_id, q.sponsor_user_id, q.sponsor_name, q.participants, q.total_minor, q.currency, now() + interval '14 days', case when q.total_minor = 0 then 'WAIVED' else 'UNPAID' end, case when q.total_minor = 0 then 'nothing to pay' end)
  returning * into inv;
  perform quizbox_interschool.refresh_funding(q.competition_id);
  perform quizbox_interschool.audit('quote_accepted', q.competition_id, jsonb_build_object('quotation', q.id, 'invoice', inv.id));
  return to_jsonb(inv);
end $fn$;

-- Administrator funding decisions: money received outside Paystack, approved institutional credit, complimentary, or void. Each needs a note.
create or replace function public.interschool_fund_invoice(p_invoice uuid, p_action text, p_note text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare i quizbox_interschool.invoices; v text := upper(coalesce(p_action, '')); target text;
begin
  perform quizbox_interschool.require_billing();
  if not quizbox_interschool.is_admin() then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  select * into i from quizbox_interschool.invoices where id = p_invoice for update;
  if i.id is null then raise exception 'IS_NOT_FOUND' using errcode = 'P0002'; end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'IS_REASON_REQUIRED' using errcode = '22023'; end if;
  target := case v when 'RECORD_PAYMENT' then 'PAID' when 'APPROVE_CREDIT' then 'CREDIT' when 'WAIVE' then 'WAIVED' when 'VOID' then 'VOID' end;
  if target is null then raise exception 'IS_ACTION_INVALID' using errcode = '22023'; end if;
  if not ((i.status = 'UNPAID') or (i.status = 'CREDIT' and target in ('PAID', 'VOID'))) then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  update quizbox_interschool.invoices set status = target, paid_at = case when target = 'PAID' then now() end, funding_note = btrim(p_note), approved_by = auth.uid() where id = i.id;
  perform quizbox_interschool.refresh_funding(i.competition_id);
  perform quizbox_interschool.notify(i.sponsor_user_id, 'Invoice ' || i.number, case target when 'PAID' then 'Payment recorded.' when 'CREDIT' then 'Approved on credit.' when 'WAIVED' then 'Waived.' else 'Cancelled.' end, '/interschool/sponsor');
  perform quizbox_interschool.audit('invoice_' || lower(target), i.competition_id, jsonb_build_object('invoice', i.id, 'note', p_note));
  return jsonb_build_object('ok', true, 'status', target);
end $fn$;

-- Starts one online payment attempt for an unpaid invoice (the server route then opens Paystack with this reference and amount).
create or replace function public.interschool_payment_start(p_invoice uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare i quizbox_interschool.invoices; a quizbox_interschool.payment_attempts;
begin
  perform quizbox_interschool.require_billing();
  select * into i from quizbox_interschool.invoices where id = p_invoice for update;
  if i.id is null or not (i.sponsor_user_id = auth.uid() or quizbox_interschool.is_admin()) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  if i.status not in ('UNPAID', 'CREDIT') then raise exception 'IS_INVOICE_ALREADY_SETTLED' using errcode = '55000'; end if;
  if i.amount_minor < 500 then raise exception 'QB_BELOW_MINIMUM_CHARGE' using errcode = '55000'; end if;
  if (select count(*) from quizbox_interschool.payment_attempts p where p.invoice_id = i.id and p.created_at > now() - interval '1 hour') >= 10 then raise exception 'IS_RATE_LIMITED' using errcode = '53400'; end if;
  insert into quizbox_interschool.payment_attempts(invoice_id, payer_user_id, amount_minor) values (i.id, auth.uid(), i.amount_minor) returning * into a;
  return jsonb_build_object('reference', a.reference, 'amount_minor', a.amount_minor, 'currency', i.currency, 'invoice', i.number, 'competition_id', i.competition_id);
end $fn$;

-- Service role only: a payment event already verified with the provider. One event is applied once; a second successful payment of a settled invoice is recorded for refund, never credited.
create or replace function public.interschool_payment_apply(p_provider text, p_event_id text, p_reference text, p_status text, p_provider_reference text, p_amount_minor bigint, p_currency text, p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare a quizbox_interschool.payment_attempts; i quizbox_interschool.invoices; ev uuid; v_out text;
begin
  select * into a from quizbox_interschool.payment_attempts where reference = p_reference;
  if a.reference is null then return jsonb_build_object('outcome', 'unknown_reference'); end if;
  select * into i from quizbox_interschool.invoices where id = a.invoice_id for update;
  select * into a from quizbox_interschool.payment_attempts where reference = p_reference for update;
  insert into public.payment_events(provider, provider_event_id, reference, reported_status, signature_verified, payload)
  values (p_provider, p_event_id, p_reference, p_status, true, coalesce(p_payload, '{}'::jsonb)) on conflict (provider, provider_event_id) do nothing returning id into ev;
  if ev is null then return jsonb_build_object('outcome', 'duplicate_event'); end if;
  if p_status = 'successful' then
    if a.status in ('successful', 'duplicate') then v_out := 'already_settled';
    elsif p_amount_minor is distinct from a.amount_minor or p_currency is distinct from i.currency or a.amount_minor <> i.amount_minor then
      update quizbox_interschool.payment_attempts set status = 'mismatch' where reference = a.reference; v_out := 'amount_mismatch';
    elsif i.status not in ('UNPAID', 'CREDIT') then
      update quizbox_interschool.payment_attempts set status = 'duplicate', settled_at = now() where reference = a.reference; v_out := 'duplicate_payment';
      perform quizbox_interschool.audit('duplicate_payment', i.competition_id, jsonb_build_object('invoice', i.id, 'reference', a.reference));
    else
      update quizbox_interschool.payment_attempts set status = 'successful', settled_at = now() where reference = a.reference;
      update quizbox_interschool.invoices set status = 'PAID', paid_at = now(), paid_reference = coalesce(p_provider_reference, a.reference) where id = i.id;
      perform quizbox_interschool.refresh_funding(i.competition_id);
      perform quizbox_interschool.notify(i.sponsor_user_id, 'Payment received', 'Invoice ' || i.number || ' is paid. Thank you.', '/interschool/sponsor');
      perform quizbox_interschool.notify((select c.organiser_user_id from quizbox_interschool.competitions c where c.id = i.competition_id and c.organiser_user_id is distinct from i.sponsor_user_id), 'Sponsorship paid', 'Invoice ' || i.number || ' is paid.', '/interschool/manage/' || i.competition_id);
      perform quizbox_interschool.audit('invoice_paid_online', i.competition_id, jsonb_build_object('invoice', i.id, 'reference', a.reference));
      v_out := 'credited';
    end if;
  elsif p_status in ('refunded', 'reversed') then
    if a.status = 'successful' then
      update quizbox_interschool.invoices set status = 'REFUNDED', funding_note = 'payment ' || p_status where id = i.id and status = 'PAID';
      perform quizbox_interschool.refresh_funding(i.competition_id);
      perform quizbox_interschool.audit('invoice_refunded', i.competition_id, jsonb_build_object('invoice', i.id, 'reference', a.reference));
    end if;
    update quizbox_interschool.payment_attempts set status = 'refunded' where reference = a.reference; v_out := p_status;
  elsif p_status in ('failed', 'cancelled', 'expired') then
    update quizbox_interschool.payment_attempts set status = 'failed' where reference = a.reference and status = 'initiated'; v_out := 'status_updated';
  else v_out := 'status_updated';
  end if;
  update public.payment_events set outcome = v_out where id = ev;
  return jsonb_build_object('outcome', v_out);
end $fn$;

-- Service role only: who started an attempt and how it ended, so the return page can confirm a payment for its own payer.
create or replace function public.interschool_payment_status(p_reference text) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('payer_user_id', a.payer_user_id, 'sponsor_user_id', i.sponsor_user_id, 'status', a.status, 'invoice_status', i.status)
    from quizbox_interschool.payment_attempts a join quizbox_interschool.invoices i on i.id = a.invoice_id where a.reference = p_reference
$fn$;

-- Numbers only, for sponsors. Groups smaller than 10 learners are not broken down, so no individual can be picked out.
create or replace function quizbox_interschool.aggregate(p_competition uuid) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object(
    'schools_registered', (select count(*) from quizbox_interschool.school_entries e where e.competition_id = p_competition and e.status = 'REGISTERED'),
    'schools_invited', (select count(*) from quizbox_interschool.school_entries e where e.competition_id = p_competition and e.invited_at is not null),
    'expected_participants', (select c.expected_participants from quizbox_interschool.competitions c where c.id = p_competition),
    'funded_participants', (select c.funded_participants from quizbox_interschool.competitions c where c.id = p_competition),
    'registered_participants', (select count(*) from quizbox_interschool.candidates k where k.competition_id = p_competition and k.status in ('PENDING', 'CONFIRMED')),
    'took_part', (select count(distinct s.candidate_id) from quizbox_interschool.sittings s join quizbox_interschool.candidates k on k.id = s.candidate_id where k.competition_id = p_competition),
    'regions', coalesce((select jsonb_agg(jsonb_build_object('region', x.region, 'schools', x.schools, 'learners', case when x.learners >= 10 then x.learners end) order by x.schools desc, x.region) from (
        select coalesce(nullif(i.region, ''), 'Not stated') as region, count(distinct e.institution_id) as schools, count(k.id) as learners
          from quizbox_interschool.school_entries e join public.institutions i on i.id = e.institution_id
          left join quizbox_interschool.candidates k on k.competition_id = e.competition_id and k.institution_id = e.institution_id and k.status = 'CONFIRMED'
         where e.competition_id = p_competition and e.status = 'REGISTERED' group by 1) x), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('division', d.title, 'round', r.title, 'finalised', r.finalised_at is not null,
          'eligible', y.eligible, 'completed', y.completed, 'completion_percent', case when y.eligible > 0 then round(100.0 * y.completed / y.eligible, 1) end,
          'average_percent', case when y.completed >= 10 then y.average end) order by d.position, r.round_no)
        from quizbox_interschool.rounds r join quizbox_interschool.divisions d on d.id = r.division_id
        cross join lateral (select count(*) as eligible, count(*) filter (where not z.absent) as completed, round(avg(z.percent) filter (where not z.absent), 1) as average from quizbox_interschool.round_results z where z.round_id = r.id) y
       where d.competition_id = p_competition and r.finalised_at is not null), '[]'::jsonb),
    'sources', coalesce((select jsonb_object_agg(s.source, s.n) from (select k.source, count(*) n from quizbox_interschool.candidates k where k.competition_id = p_competition and k.status in ('PENDING', 'CONFIRMED') group by k.source) s), '{}'::jsonb),
    'page_views', (select count(*) from quizbox_interschool.events v where v.competition_id = p_competition and v.kind = 'view'),
    'shares', (select count(*) from quizbox_interschool.events v where v.competition_id = p_competition and v.kind = 'share'))
$fn$;

-- A sponsor's competitions with their own quotations and invoices.
create or replace function public.interschool_sponsor_home() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_interschool.require_billing();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'title', c.title, 'status', c.status, 'funding', c.funding, 'organiser', c.organiser_user_id = auth.uid(), 'capacity', c.capacity,
      'funding_cleared', c.funding_cleared_at is not null, 'registration', quizbox_interschool.registration_state(c),
      'quotations', coalesce((select jsonb_agg(to_jsonb(q) - 'issued_by' - 'accepted_by' order by q.version desc) from quizbox_interschool.quotations q where q.competition_id = c.id and q.sponsor_user_id = auth.uid()), '[]'::jsonb),
      'invoices', coalesce((select jsonb_agg(to_jsonb(i) - 'approved_by' order by i.created_at desc) from quizbox_interschool.invoices i where i.competition_id = c.id and i.sponsor_user_id = auth.uid()), '[]'::jsonb),
      'figures', quizbox_interschool.aggregate(c.id)) order by c.created_at desc)
    from quizbox_interschool.competitions c
   where (c.organiser_user_id = auth.uid() and c.organiser_kind = 'SPONSOR') or exists (select 1 from quizbox_interschool.quotations q where q.competition_id = c.id and q.sponsor_user_id = auth.uid())), '[]'::jsonb);
end $fn$;

-- Billing of one competition for its managers, plus the figures. Administrators see every quotation and invoice.
create or replace function public.interschool_billing(p_competition uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; admin boolean;
begin
  c := quizbox_interschool.managed(p_competition);
  admin := quizbox_interschool.is_admin();
  return jsonb_build_object('funding', c.funding, 'funded_participants', c.funded_participants, 'capacity', c.capacity, 'funding_cleared', c.funding_cleared_at is not null,
    'rate_minor', quizbox_core.setting('interschool.rate_per_participant_minor'), 'setup_fee_minor', quizbox_core.setting('interschool.setup_fee_minor'),
    'billing_on', coalesce(quizbox_core.flag('flags.interschool_sponsorship'), false),
    'quotations', coalesce((select jsonb_agg(to_jsonb(q) order by q.version desc) from quizbox_interschool.quotations q where q.competition_id = c.id and (admin or q.sponsor_user_id = auth.uid())), '[]'::jsonb),
    'invoices', coalesce((select jsonb_agg(to_jsonb(i) || jsonb_build_object('attempts', (select count(*) from quizbox_interschool.payment_attempts a where a.invoice_id = i.id),
        'needs_refund', exists (select 1 from quizbox_interschool.payment_attempts a where a.invoice_id = i.id and a.status in ('duplicate', 'mismatch'))) order by i.created_at desc)
      from quizbox_interschool.invoices i where i.competition_id = c.id and (admin or i.sponsor_user_id = auth.uid())), '[]'::jsonb),
    'figures', quizbox_interschool.aggregate(c.id));
end $fn$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'quizbox_interschool' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
revoke all on function public.interschool_set_rate(bigint, bigint), public.interschool_quote(uuid, integer, uuid, text, bigint, text, bigint), public.interschool_decide_quote(uuid, boolean), public.interschool_fund_invoice(uuid, text, text),
  public.interschool_payment_start(uuid), public.interschool_payment_apply(text, text, text, text, text, bigint, text, jsonb), public.interschool_sponsor_home(), public.interschool_billing(uuid), public.interschool_payment_status(text) from public, anon, authenticated;
grant execute on function public.interschool_set_rate(bigint, bigint), public.interschool_quote(uuid, integer, uuid, text, bigint, text, bigint), public.interschool_decide_quote(uuid, boolean), public.interschool_fund_invoice(uuid, text, text),
  public.interschool_payment_start(uuid), public.interschool_sponsor_home(), public.interschool_billing(uuid) to authenticated;
grant execute on function public.interschool_payment_apply(text, text, text, text, text, bigint, text, jsonb), public.interschool_payment_status(text) to service_role;

commit;
notify pgrst, 'reload schema';
