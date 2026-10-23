create or replace function public.qb_export_catalog() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('key', d.key, 'label', d.label, 'group', d.grp, 'date_label', d.date_label, 'category_label', d.category_label, 'categories', to_jsonb(d.categories), 'description', d.descr))
    from public.qb_export_defs() d where public.qb_export_can(d.need) and to_regclass(d.tbl) is not null), '[]'::jsonb);
end $fn$;

-- Builds one dataset. Internal: callers go through qb_export_run, which checks who is asking. Returns {columns, rows, total, truncated}; each row is a list in the column order.
-- The datasets are built by five small functions (a to e), each answering only its own datasets and returning null for any other, so this one dispatches.

create or replace function public.qb_export_build_a(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_cols text[]; v_rows jsonb; v_total bigint;
begin
  case p_dataset
  when 'payments' then
    v_cols := array['Reference', 'Created (UTC)', 'Settled (UTC)', 'Status', 'Purpose', 'Plan or item', 'Source', 'Provider', 'Method', 'Currency', 'Amount', 'Coins', 'Reconciliation', 'Buyer email', 'Buyer role', 'Paid by email'];
    with f as (select i.created_at as k, jsonb_build_array(i.reference, public.qb_export_ts(i.created_at), public.qb_export_ts(i.settled_at), i.status, coalesce(i.metadata ->> 'purpose', 'coins'), coalesce(i.metadata ->> 'plan', i.metadata ->> 'item_title'),
        nullif(concat_ws(' · ', i.metadata ->> 'item_subject', i.metadata ->> 'item_school'), ''), i.provider, i.method, i.currency_code, round(i.amount_minor / 100.0, 2), i.coins, i.reconciliation_status, b.email, lower(b.role::text), pa.email) as r
      from public.payment_intents i left join public.profiles b on b.id = i.beneficiary_user_id left join public.profiles pa on pa.id = i.payer_user_id
      where (p_from is null or i.created_at >= p_from) and (p_to is null or i.created_at < p_to) and (p_category is null or i.status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'subscriptions' then
    v_cols := array['Created (UTC)', 'Learner email', 'Plan', 'Status', 'Source', 'Payment reference', 'Valid from (UTC)', 'Valid until (UTC)', 'Revoked (UTC)', 'Note'];
    with f as (select s.created_at as k, jsonb_build_array(public.qb_export_ts(s.created_at), u.email, s.plan, s.status, s.source, s.source_ref, public.qb_export_ts(s.valid_from), public.qb_export_ts(s.valid_until), public.qb_export_ts(s.revoked_at), left(s.note, 300)) as r
      from public.learner_subscriptions s left join public.profiles u on u.id = s.user_id
      where (p_from is null or s.created_at >= p_from) and (p_to is null or s.created_at < p_to) and (p_category is null or s.status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'coin_ledger' then
    v_cols := array['Created (UTC)', 'Account email', 'Type', 'Bucket', 'Coins', 'Balance after', 'Reason'];
    with f as (select t.created_at as k, jsonb_build_array(public.qb_export_ts(t.created_at), u.email, t.kind, t.bucket, t.amount, t.balance_after, left(t.reason, 200)) as r
      from public.coin_transactions t left join public.wallets w on w.id = t.wallet_id left join public.profiles u on u.id = w.user_id
      where (p_from is null or t.created_at >= p_from) and (p_to is null or t.created_at < p_to) and (p_category is null or t.kind = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'refund_cases' then
    v_cols := array['Requested (UTC)', 'Payment reference', 'Account email', 'Kind', 'Status', 'Coins credited', 'Decided (UTC)', 'Decision note'];
    with f as (select c.requested_at as k, jsonb_build_array(public.qb_export_ts(c.requested_at), c.payment_reference, u.email, c.kind, c.status, c.coins_credited, public.qb_export_ts(c.decided_at), left(c.decision_note, 300)) as r
      from public.refund_cases c left join public.profiles u on u.id = c.beneficiary_user_id
      where (p_from is null or c.requested_at >= p_from) and (p_to is null or c.requested_at < p_to) and (p_category is null or c.status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'price_list' then
    v_cols := array['Code', 'Name', 'For', 'Kind', 'Period', 'Price', 'Currency', 'Active', 'Updated (UTC)'];
    with f as (select p.updated_at as k, jsonb_build_array(p.code, p.name, p.audience, p.kind, p.period, round(p.price_minor / 100.0, 2), p.currency, p.active, public.qb_export_ts(p.updated_at)) as r
      from public.price_list p
      where (p_from is null or p.updated_at >= p_from) and (p_to is null or p.updated_at < p_to) and (p_category is null or p.audience = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  else return null;
  end case;
  return jsonb_build_object('columns', to_jsonb(v_cols), 'rows', v_rows, 'total', v_total, 'truncated', v_total > jsonb_array_length(v_rows));
end $fn$;

