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
