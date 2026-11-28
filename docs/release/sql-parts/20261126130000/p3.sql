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
