-- Send a set for review. The seller must be verified; the set needs enough questions; questions identical to another seller's are counted so the reviewer can see it.
create or replace function public.qb_mk_item_submit(p_item uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare s public.mk_sellers; it public.mk_items; dup integer;
begin
  s := public.qb_mk_my_seller();
  if s.status <> 'verified' then raise exception 'QB_SELLER_NOT_VERIFIED' using errcode = '55000'; end if;
  select * into it from public.mk_items where id = p_item and seller_id = s.id for update;
  if it.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if it.status not in ('draft', 'rejected', 'unlisted') then raise exception 'QB_ITEM_LOCKED' using errcode = '55000'; end if;
  if it.question_count < public.qb_mk_num('marketplace.min_questions', 10) then raise exception 'QB_TOO_FEW_QUESTIONS' using errcode = '22023'; end if;
  select count(*) into dup from public.mk_questions q where q.item_id = it.id and exists (select 1 from public.mk_questions o join public.mk_items oi on oi.id = o.item_id where o.fingerprint = q.fingerprint and oi.seller_id <> s.id);
  update public.mk_items set status = 'submitted', dup_matches = dup, review_note = '', updated_at = now() where id = it.id;
  return jsonb_build_object('ok', true, 'status', 'submitted', 'duplicates', dup);
end $fn$;

create or replace function public.qb_mk_item_unlist(p_item uuid) returns void language plpgsql security definer set search_path = '' as $fn$
declare s public.mk_sellers;
begin
  s := public.qb_mk_my_seller();
  update public.mk_items set status = 'unlisted', updated_at = now() where id = p_item and seller_id = s.id and status in ('approved', 'submitted');
  if not found then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
end $fn$;

create or replace function public.qb_mk_my_item(p_item uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare s public.mk_sellers; it public.mk_items;
begin
  s := public.qb_mk_my_seller();
  select * into it from public.mk_items where id = p_item and seller_id = s.id;
  if it.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  return to_jsonb(it) || jsonb_build_object('questions', coalesce((select jsonb_agg(jsonb_build_object('question_text', q.question_text, 'options', q.options, 'correct_index', q.correct_index, 'explanation', q.explanation) order by q.position) from public.mk_questions q where q.item_id = it.id), '[]'::jsonb));
end $fn$;

-- The seller's items, each with its sales: how many, the gross price, and the teacher's share.
create or replace function public.qb_mk_my_items() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare s public.mk_sellers;
begin
  s := public.qb_mk_my_seller();
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'slug', i.slug, 'title', i.title, 'subject', i.subject, 'grade', i.grade, 'term', i.term, 'school_name', i.school_name, 'price_minor', i.price_minor, 'status', i.status,
      'review_note', i.review_note, 'question_count', i.question_count, 'updated_at', i.updated_at,
      'sales', (select count(*) from public.mk_purchases p where p.item_id = i.id and p.status = 'active'),
      'gross_minor', coalesce((select sum(p.price_minor) from public.mk_purchases p where p.item_id = i.id and p.status = 'active'), 0),
      'share_minor', coalesce((select sum(p.seller_share_minor) from public.mk_purchases p where p.item_id = i.id and p.status = 'active'), 0)) order by i.updated_at desc)
    from public.mk_items i where i.seller_id = s.id), '[]'::jsonb);
end $fn$;

create or replace function public.qb_mk_my_sales(p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare s public.mk_sellers;
begin
  s := public.qb_mk_my_seller();
  return coalesce((select jsonb_agg(x order by x ->> 'purchased_at' desc) from (
    select jsonb_build_object('item', p.item_title, 'school', p.item_school, 'subject', p.item_subject, 'price_minor', p.price_minor, 'share_minor', p.seller_share_minor, 'fee_minor', p.platform_fee_minor,
      'status', p.status, 'purchased_at', p.purchased_at) as x
    from public.mk_purchases p where p.seller_id = s.id order by p.purchased_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) y), '[]'::jsonb);
end $fn$;

create or replace function public.qb_mk_seller_summary() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare s public.mk_sellers; v_avail bigint; v_hold bigint; v_req bigint; v_paid bigint;
begin
  s := public.qb_mk_my_seller();
  select coalesce(sum(amount_minor) filter (where available_at <= now()), 0), coalesce(sum(amount_minor) filter (where available_at > now()), 0) into v_avail, v_hold from public.mk_ledger where seller_id = s.id;
  select coalesce(sum(amount_minor) filter (where status = 'requested'), 0), coalesce(sum(amount_minor) filter (where status = 'paid'), 0) into v_req, v_paid from public.mk_payouts where seller_id = s.id;
  return jsonb_build_object('status', s.status,
    'available_minor', v_avail, 'in_hold_minor', v_hold, 'requested_minor', v_req, 'paid_minor', v_paid,
    'sales', (select count(*) from public.mk_purchases where seller_id = s.id and status = 'active'),
    'gross_minor', coalesce((select sum(price_minor) from public.mk_purchases where seller_id = s.id and status = 'active'), 0),
    'share_minor', coalesce((select sum(seller_share_minor) from public.mk_purchases where seller_id = s.id and status = 'active'), 0),
    'fee_minor', coalesce((select sum(platform_fee_minor) from public.mk_purchases where seller_id = s.id and status = 'active'), 0),
    'share_percent', public.qb_mk_num('marketplace.seller_share_percent', 60), 'hold_days', public.qb_mk_num('marketplace.hold_days', 7), 'min_payout_minor', public.qb_mk_num('marketplace.min_payout_minor', 2000));
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Payouts: quote (what the teacher will approve), request, cancel
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mk_quote_for(p_seller uuid) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object(
    'amount_minor', coalesce(sum(l.amount_minor), 0),
    'sales_count', count(*) filter (where l.kind = 'sale'),
    'gross_minor', coalesce(sum(p.price_minor) filter (where l.kind = 'sale'), 0),
    'platform_fee_minor', coalesce(sum(p.platform_fee_minor) filter (where l.kind = 'sale'), 0),
    'refunds_minor', coalesce(-sum(l.amount_minor) filter (where l.kind = 'reversal'), 0),
    'adjustments_minor', coalesce(sum(l.amount_minor) filter (where l.kind = 'adjustment'), 0),
    'share_percent', public.qb_mk_num('marketplace.seller_share_percent', 60))
  from public.mk_ledger l left join public.mk_purchases p on p.id = l.purchase_id
  where l.seller_id = p_seller and l.payout_id is null and l.kind in ('sale', 'reversal', 'adjustment') and l.available_at <= now();
$fn$;
revoke all on function public.qb_mk_quote_for(uuid) from public, anon, authenticated;

create or replace function public.qb_mk_payout_quote() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare s public.mk_sellers; q jsonb;
begin
  s := public.qb_mk_my_seller();
  q := public.qb_mk_quote_for(s.id);
  return q || jsonb_build_object('min_payout_minor', public.qb_mk_num('marketplace.min_payout_minor', 2000), 'can_request', s.status = 'verified' and (q ->> 'amount_minor')::bigint >= public.qb_mk_num('marketplace.min_payout_minor', 2000),
    'destination', jsonb_build_object('method', s.payout_method, 'network', s.payout_network, 'account_masked', repeat('*', greatest(length(s.payout_account) - 4, 0)) || right(s.payout_account, 4), 'name', s.payout_account_name));
end $fn$;
