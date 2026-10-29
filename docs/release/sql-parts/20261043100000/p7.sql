create or replace function public.qb_mk_fulfil_purchase(p_reference text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare i public.payment_intents; it public.mk_items; s public.mk_sellers; pur public.mk_purchases; v_price bigint; v_split bigint[]; v_hold numeric := public.qb_mk_num('marketplace.hold_days', 7);
begin
  select * into i from public.payment_intents where reference = p_reference for update;
  if i.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if i.metadata ->> 'purpose' is distinct from 'marketplace' then return jsonb_build_object('outcome', 'not_marketplace'); end if;
  if i.status <> 'successful' or i.credited_tx_id is null then return jsonb_build_object('outcome', 'not_settled'); end if;
  select * into pur from public.mk_purchases where payment_reference = p_reference;
  if pur.id is not null then return jsonb_build_object('outcome', 'already_fulfilled', 'purchase', pur.id); end if;
  v_price := (i.metadata ->> 'price_minor')::bigint;
  if v_price is null or v_price <> i.amount_minor then return jsonb_build_object('outcome', 'amount_mismatch'); end if;
  select * into it from public.mk_items where id = (i.metadata ->> 'item_id')::uuid;
  select * into s from public.mk_sellers where id = it.seller_id;
  if it.id is null or s.id is null then return jsonb_build_object('outcome', 'item_missing'); end if;
  perform public.qb_coin_spend(i.beneficiary_user_id, i.coins, 'marketplace', p_reference, 'mkbuy-' || p_reference);
  v_split := public.qb_mk_split(v_price);
  insert into public.mk_purchases(item_id, seller_id, buyer_user_id, payment_reference, item_title, item_subject, item_school, item_grade, price_minor, seller_share_minor, platform_fee_minor, expires_at)
  values (it.id, s.id, i.beneficiary_user_id, p_reference, it.title, it.subject, it.school_name, it.grade, v_price, v_split[1], v_split[2], now() + make_interval(days => public.qb_mk_num('marketplace.access_days', 90)::int)) returning * into pur;
  insert into public.mk_ledger(seller_id, kind, amount_minor, purchase_id, available_at, note) values (s.id, 'sale', v_split[1], pur.id, now() + make_interval(days => v_hold::int), 'Sale of ' || left(it.title, 120));
  update public.mk_items set purchases_count = purchases_count + 1 where id = it.id;
  perform public.qb_mk_notify(s.user_id, 'You made a sale', 'Someone bought "' || left(it.title, 100) || '". Your share is GHS ' || (v_split[1] / 100.0)::numeric(12, 2)::text || '.', '/seller');
  perform public.qb_mk_notify(i.beneficiary_user_id, 'Your question set is ready', '"' || left(it.title, 100) || '" is yours for ' || public.qb_mk_num('marketplace.access_days', 90)::int::text || ' days.', '/marketplace/mine');
  return jsonb_build_object('outcome', 'fulfilled', 'purchase', pur.id, 'seller_share_minor', v_split[1], 'platform_fee_minor', v_split[2]);
end $fn$;

-- A refund ends the buyer's access and takes the teacher's share back (together with the original sale if it is still being held; as a debit on the balance if it was already available or paid out).
create or replace function public.qb_mk_reverse_core(p_reference text, p_reason text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare pur public.mk_purchases; sale public.mk_ledger;
begin
  select * into pur from public.mk_purchases where payment_reference = p_reference for update;
  if pur.id is null then return jsonb_build_object('outcome', 'not_marketplace'); end if;
  if pur.status = 'reversed' then return jsonb_build_object('outcome', 'already_reversed'); end if;
  select * into sale from public.mk_ledger where purchase_id = pur.id and kind = 'sale';
  update public.mk_purchases set status = 'reversed', reversed_at = now(), reversal_reason = left(coalesce(p_reason, 'refunded'), 300) where id = pur.id;
  insert into public.mk_ledger(seller_id, kind, amount_minor, purchase_id, available_at, note)
  values (pur.seller_id, 'reversal', -pur.seller_share_minor, pur.id, greatest(now(), coalesce(sale.available_at, now())), 'Refund of ' || left(pur.item_title, 120));
  update public.mk_items set purchases_count = greatest(purchases_count - 1, 0) where id = pur.item_id;
  perform public.qb_mk_notify((select user_id from public.mk_sellers where id = pur.seller_id), 'A sale was refunded', '"' || left(pur.item_title, 100) || '" was refunded, so your share for it was taken back.', '/seller');
  return jsonb_build_object('outcome', 'reversed', 'purchase', pur.id);
end $fn$;
revoke all on function public.qb_mk_reverse_core(text, text) from public, anon, authenticated;
create or replace function public.qb_mk_reverse_purchase(p_reference text, p_reason text default 'refunded') returns jsonb language sql security definer set search_path = '' as $fn$ select public.qb_mk_reverse_core(p_reference, p_reason); $fn$;
create or replace function public.qb_mk_admin_reverse(p_reference text, p_reason text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare r jsonb;
begin
  if not public.qb_mk_is_staff('finance') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'QB_REASON_REQUIRED' using errcode = '22023'; end if;
  r := public.qb_mk_reverse_core(btrim(p_reference), p_reason);
  if r ->> 'outcome' = 'not_marketplace' then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  perform quizbox_core.audit('marketplace.reverse', 'mk_purchases', (r ->> 'purchase')::uuid, jsonb_build_object('reference', p_reference));
  return r;
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mk_admin_items(p_status text default 'submitted') returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_mk_is_staff('review') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'slug', i.slug, 'title', i.title, 'subject', i.subject, 'grade', i.grade, 'term', i.term, 'school', i.school_name, 'price_minor', i.price_minor, 'status', i.status,
      'questions', i.question_count, 'duplicates', i.dup_matches, 'seller', s.display_name, 'seller_status', s.status, 'purchases', i.purchases_count, 'updated_at', i.updated_at) order by i.updated_at desc)
    from public.mk_items i join public.mk_sellers s on s.id = i.seller_id where p_status is null or p_status = '' or i.status = p_status), '[]'::jsonb);
end $fn$;

create or replace function public.qb_mk_admin_item(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare it public.mk_items;
begin
  if not public.qb_mk_is_staff('review') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  select * into it from public.mk_items where id = p_id;
  if it.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  return to_jsonb(it) || jsonb_build_object('seller', (select jsonb_build_object('name', s.display_name, 'school', s.school_name, 'status', s.status) from public.mk_sellers s where s.id = it.seller_id),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('question_text', q.question_text, 'options', q.options, 'correct_index', q.correct_index, 'explanation', q.explanation,
        'duplicate', exists (select 1 from public.mk_questions o join public.mk_items oi on oi.id = o.item_id where o.fingerprint = q.fingerprint and oi.seller_id <> it.seller_id)) order by q.position) from public.mk_questions q where q.item_id = it.id), '[]'::jsonb));
end $fn$;
