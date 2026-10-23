create or replace function public.qb_mk_payout_request(p_expected bigint) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare s public.mk_sellers; q jsonb; v_amount bigint; po public.mk_payouts;
begin
  s := public.qb_mk_my_seller();
  perform 1 from public.mk_sellers where id = s.id for update;
  if s.status <> 'verified' then raise exception 'QB_SELLER_NOT_VERIFIED' using errcode = '55000'; end if;
  if exists (select 1 from public.mk_payouts where seller_id = s.id and status = 'requested') then raise exception 'QB_PAYOUT_ALREADY_REQUESTED' using errcode = '55000'; end if;
  q := public.qb_mk_quote_for(s.id); v_amount := (q ->> 'amount_minor')::bigint;
  if v_amount < public.qb_mk_num('marketplace.min_payout_minor', 2000) then raise exception 'QB_PAYOUT_BELOW_MINIMUM' using errcode = '22023'; end if;
  if p_expected is distinct from v_amount then raise exception 'QB_QUOTE_CHANGED' using errcode = '55000'; end if;
  insert into public.mk_payouts(seller_id, amount_minor, gross_minor, platform_fee_minor, refunds_minor, sales_count, destination, due_at)
  values (s.id, v_amount, (q ->> 'gross_minor')::bigint, (q ->> 'platform_fee_minor')::bigint, (q ->> 'refunds_minor')::bigint, (q ->> 'sales_count')::integer,
          jsonb_build_object('method', s.payout_method, 'network', s.payout_network, 'account', s.payout_account, 'name', s.payout_account_name, 'phone', s.phone), public.qb_mk_due_at(now())) returning * into po;
  update public.mk_ledger set payout_id = po.id where seller_id = s.id and payout_id is null and kind in ('sale', 'reversal', 'adjustment') and available_at <= now();
  insert into public.mk_ledger(seller_id, kind, amount_minor, payout_id, note) values (s.id, 'payout_reserved', -v_amount, po.id, 'Payout requested');
  perform quizbox_core.audit('marketplace.payout_request', 'mk_payouts', po.id, jsonb_build_object('amount_minor', v_amount));
  return jsonb_build_object('ok', true, 'payout', po.id, 'amount_minor', v_amount, 'due_at', po.due_at);
end $fn$;

-- Returns a payout's money to the seller's balance (rejected or cancelled): the included entries become available to include again.
create or replace function public.qb_mk_payout_release(p_payout uuid, p_status text, p_note text, p_actor uuid) returns void language plpgsql security definer set search_path = '' as $fn$
declare po public.mk_payouts;
begin
  select * into po from public.mk_payouts where id = p_payout for update;
  if po.id is null or po.status <> 'requested' then raise exception 'QB_PAYOUT_NOT_OPEN' using errcode = '55000'; end if;
  update public.mk_ledger set payout_id = null where payout_id = po.id and kind in ('sale', 'reversal', 'adjustment');
  insert into public.mk_ledger(seller_id, kind, amount_minor, payout_id, note) values (po.seller_id, 'payout_released', po.amount_minor, po.id, left(coalesce(p_note, ''), 300));
  update public.mk_payouts set status = p_status, decided_note = left(coalesce(p_note, ''), 500), paid_by = p_actor where id = po.id;
end $fn$;
revoke all on function public.qb_mk_payout_release(uuid, text, text, uuid) from public, anon, authenticated;

create or replace function public.qb_mk_payout_cancel(p_payout uuid) returns void language plpgsql security definer set search_path = '' as $fn$
declare s public.mk_sellers;
begin
  s := public.qb_mk_my_seller();
  if not exists (select 1 from public.mk_payouts where id = p_payout and seller_id = s.id) then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.qb_mk_payout_release(p_payout, 'cancelled', 'Cancelled by the seller', auth.uid());
end $fn$;

create or replace function public.qb_mk_my_payouts() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare s public.mk_sellers;
begin
  s := public.qb_mk_my_seller();
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'amount_minor', p.amount_minor, 'gross_minor', p.gross_minor, 'platform_fee_minor', p.platform_fee_minor, 'refunds_minor', p.refunds_minor, 'sales_count', p.sales_count,
      'status', p.status, 'requested_at', p.requested_at, 'due_at', p.due_at, 'paid_at', p.paid_at, 'transfer_ref', p.transfer_ref, 'note', p.decided_note) order by p.requested_at desc)
    from public.mk_payouts p where p.seller_id = s.id), '[]'::jsonb);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Buyer
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mk_catalog(p_q text default null, p_subject text default null, p_grade text default null, p_school text default null, p_limit integer default 48, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare q text := nullif(btrim(regexp_replace(replace(coalesce(p_q, ''), chr(92), ''), '[%_]', '', 'g')), '');
begin
  if not quizbox_core.flag('flags.marketplace') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x order by (x ->> 'purchases')::int desc, x ->> 'title') from (
    select jsonb_build_object('slug', i.slug, 'title', i.title, 'subject', i.subject, 'grade', i.grade, 'term', i.term, 'school', i.school_name, 'price_minor', i.price_minor, 'questions', i.question_count,
           'seller', s.display_name, 'purchases', i.purchases_count, 'summary', left(i.description, 160)) as x
      from public.mk_items i join public.mk_sellers s on s.id = i.seller_id
     where i.status = 'approved' and s.status = 'verified'
       and (p_subject is null or i.subject = p_subject) and (p_grade is null or i.grade = p_grade) and (p_school is null or i.school_name = p_school)
       and (q is null or i.title ilike '%' || q || '%' or i.subject ilike '%' || q || '%' or i.school_name ilike '%' || q || '%' or i.description ilike '%' || q || '%')
     order by i.purchases_count desc, i.title limit least(greatest(coalesce(p_limit, 48), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) y), '[]'::jsonb);
end $fn$;

-- One listing: everything a buyer needs to decide (the source line is subject, school, class and term) plus three sample question stems, without answers.
create or replace function public.qb_mk_item_public(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare it public.mk_items; s public.mk_sellers; pur public.mk_purchases;
begin
  if not quizbox_core.flag('flags.marketplace') then return null; end if;
  select * into it from public.mk_items where slug = lower(btrim(coalesce(p_slug, ''))) and status = 'approved';
  if it.id is null then return null; end if;
  select * into s from public.mk_sellers where id = it.seller_id;
  if s.status <> 'verified' then return null; end if;
  if auth.uid() is not null then select * into pur from public.mk_purchases where item_id = it.id and buyer_user_id = auth.uid() and status = 'active' and expires_at > now() order by expires_at desc limit 1; end if;
  return jsonb_build_object('id', it.id, 'slug', it.slug, 'title', it.title, 'description', it.description, 'subject', it.subject, 'grade', it.grade, 'term', it.term, 'school', it.school_name,
    'price_minor', it.price_minor, 'questions', it.question_count, 'seller', s.display_name, 'purchases', it.purchases_count, 'access_days', public.qb_mk_num('marketplace.access_days', 90),
    'samples', coalesce((select jsonb_agg(q.question_text order by q.position) from (select question_text, position from public.mk_questions where item_id = it.id order by position limit 3) q), '[]'::jsonb),
    'mine', case when auth.uid() is not null and s.user_id = auth.uid() then true else false end,
    'owned_until', pur.expires_at);
end $fn$;

-- Before the checkout: may this signed-in person buy this set? Returns what the checkout needs. A seller cannot buy their own set; a child cannot pay; a set still in the 90 days is not sold again.
