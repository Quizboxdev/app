create or replace function public.qb_mk_admin_summary() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_mk_is_staff('finance') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object(
    'gross_minor', coalesce((select sum(price_minor) from public.mk_purchases where status = 'active'), 0),
    'platform_fee_minor', coalesce((select sum(platform_fee_minor) from public.mk_purchases where status = 'active'), 0),
    'seller_share_minor', coalesce((select sum(seller_share_minor) from public.mk_purchases where status = 'active'), 0),
    'sales_count', (select count(*) from public.mk_purchases where status = 'active'),
    'refunded_minor', coalesce((select sum(price_minor) from public.mk_purchases where status = 'reversed'), 0), 'refunded_count', (select count(*) from public.mk_purchases where status = 'reversed'),
    'owed_to_sellers_minor', coalesce((select sum(amount_minor) from public.mk_ledger), 0) + coalesce((select sum(amount_minor) from public.mk_payouts where status = 'requested'), 0),
    'payouts_requested_minor', coalesce((select sum(amount_minor) from public.mk_payouts where status = 'requested'), 0), 'payouts_requested_count', (select count(*) from public.mk_payouts where status = 'requested'),
    'payouts_overdue_count', (select count(*) from public.mk_payouts where status = 'requested' and due_at < now()),
    'paid_out_minor', coalesce((select sum(amount_minor) from public.mk_payouts where status = 'paid'), 0),
    'items', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.mk_items group by status) x), '{}'::jsonb),
    'sellers', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.mk_sellers group by status) x), '{}'::jsonb));
end $fn$;

revoke all on function public.qb_mk_seller_get(), public.qb_mk_seller_save(text, text, text, text, text, text, text, boolean), public.qb_mk_item_save(uuid, text, text, text, text, text, text, integer), public.qb_mk_item_questions_set(uuid, jsonb),
  public.qb_mk_item_submit(uuid), public.qb_mk_item_unlist(uuid), public.qb_mk_my_item(uuid), public.qb_mk_my_items(), public.qb_mk_my_sales(integer), public.qb_mk_seller_summary(), public.qb_mk_payout_quote(), public.qb_mk_payout_request(bigint),
  public.qb_mk_payout_cancel(uuid), public.qb_mk_my_payouts(), public.qb_mk_catalog(text, text, text, text, integer, integer), public.qb_mk_item_public(text), public.qb_mk_prepare_purchase(uuid), public.qb_mk_my_purchases(), public.qb_mk_open(uuid),
  public.qb_mk_record_attempt(uuid, integer, integer), public.qb_mk_set_payment_item(text, uuid, bigint), public.qb_mk_fulfil_purchase(text), public.qb_mk_reverse_purchase(text, text), public.qb_mk_admin_reverse(text, text),
  public.qb_mk_admin_items(text), public.qb_mk_admin_item(uuid), public.qb_mk_admin_review(uuid, text, text), public.qb_mk_admin_sellers(text), public.qb_mk_admin_seller_set(uuid, text, text), public.qb_mk_admin_payouts(text),
  public.qb_mk_admin_payout_set(uuid, text, text, text), public.qb_mk_admin_summary() from public, anon, authenticated;
grant execute on function public.qb_mk_seller_get(), public.qb_mk_seller_save(text, text, text, text, text, text, text, boolean), public.qb_mk_item_save(uuid, text, text, text, text, text, text, integer), public.qb_mk_item_questions_set(uuid, jsonb),
  public.qb_mk_item_submit(uuid), public.qb_mk_item_unlist(uuid), public.qb_mk_my_item(uuid), public.qb_mk_my_items(), public.qb_mk_my_sales(integer), public.qb_mk_seller_summary(), public.qb_mk_payout_quote(), public.qb_mk_payout_request(bigint),
  public.qb_mk_payout_cancel(uuid), public.qb_mk_my_payouts(), public.qb_mk_prepare_purchase(uuid), public.qb_mk_my_purchases(), public.qb_mk_open(uuid), public.qb_mk_record_attempt(uuid, integer, integer), public.qb_mk_admin_reverse(text, text),
  public.qb_mk_admin_items(text), public.qb_mk_admin_item(uuid), public.qb_mk_admin_review(uuid, text, text), public.qb_mk_admin_sellers(text), public.qb_mk_admin_seller_set(uuid, text, text), public.qb_mk_admin_payouts(text),
  public.qb_mk_admin_payout_set(uuid, text, text, text), public.qb_mk_admin_summary() to authenticated;
grant execute on function public.qb_mk_catalog(text, text, text, text, integer, integer), public.qb_mk_item_public(text) to anon, authenticated, service_role;
grant execute on function public.qb_mk_set_payment_item(text, uuid, bigint), public.qb_mk_fulfil_purchase(text), public.qb_mk_reverse_purchase(text, text) to service_role;

-- So pages can say "not open yet" instead of showing an empty shelf.
create or replace function public.qb_mk_enabled() returns boolean language sql stable security definer set search_path = '' as $fn$ select quizbox_core.flag('flags.marketplace'); $fn$;
revoke all on function public.qb_mk_enabled() from public;
grant execute on function public.qb_mk_enabled() to anon, authenticated, service_role;

notify pgrst, 'reload schema';

