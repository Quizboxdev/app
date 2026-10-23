create or replace function public.qb_mk_admin_review(p_item uuid, p_decision text, p_note text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare it public.mk_items; s public.mk_sellers;
begin
  if not public.qb_mk_is_staff('review') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'QB_INVALID_DECISION' using errcode = '22023'; end if;
  if p_decision = 'reject' and length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'QB_REASON_REQUIRED' using errcode = '22023'; end if;
  select * into it from public.mk_items where id = p_item for update;
  if it.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if it.status <> 'submitted' then raise exception 'QB_NOT_SUBMITTED' using errcode = '55000'; end if;
  select * into s from public.mk_sellers where id = it.seller_id;
  if p_decision = 'approve' and s.status <> 'verified' then raise exception 'QB_SELLER_NOT_VERIFIED' using errcode = '55000'; end if;
  update public.mk_items set status = case when p_decision = 'approve' then 'approved' else 'rejected' end, review_note = left(coalesce(p_note, ''), 500), reviewed_by = auth.uid(), reviewed_at = now(),
         approved_at = case when p_decision = 'approve' then now() else approved_at end, updated_at = now() where id = it.id;
  perform quizbox_core.audit('marketplace.review', 'mk_items', it.id, jsonb_build_object('decision', p_decision));
  perform public.qb_mk_notify(s.user_id, case when p_decision = 'approve' then 'Your question set is on sale' else 'Your question set needs changes' end, '"' || left(it.title, 100) || '"' || case when p_decision = 'approve' then ' was approved.' else ': ' || left(coalesce(p_note, ''), 150) end, '/seller/items');
  return jsonb_build_object('ok', true, 'status', case when p_decision = 'approve' then 'approved' else 'rejected' end);
end $fn$;

create or replace function public.qb_mk_admin_sellers(p_status text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_mk_is_staff('review') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'display_name', s.display_name, 'school', s.school_name, 'phone', s.phone, 'status', s.status, 'review_note', s.review_note, 'method', s.payout_method, 'network', s.payout_network,
      'account_masked', repeat('*', greatest(length(s.payout_account) - 4, 0)) || right(s.payout_account, 4), 'account_name', s.payout_account_name, 'email', p.email, 'items', (select count(*) from public.mk_items i where i.seller_id = s.id), 'created_at', s.created_at) order by s.created_at desc)
    from public.mk_sellers s join public.profiles p on p.id = s.user_id where p_status is null or p_status = '' or s.status = p_status), '[]'::jsonb);
end $fn$;

create or replace function public.qb_mk_admin_seller_set(p_seller uuid, p_status text, p_note text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare s public.mk_sellers;
begin
  if not public.qb_mk_is_staff('review') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if p_status not in ('pending', 'verified', 'suspended') then raise exception 'QB_INVALID_DECISION' using errcode = '22023'; end if;
  if p_status <> 'verified' and length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'QB_REASON_REQUIRED' using errcode = '22023'; end if;
  update public.mk_sellers set status = p_status, review_note = left(coalesce(p_note, ''), 500), verified_by = case when p_status = 'verified' then auth.uid() end, verified_at = case when p_status = 'verified' then now() end, updated_at = now()
   where id = p_seller returning * into s;
  if s.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_status = 'suspended' then update public.mk_items set status = 'unlisted', updated_at = now() where seller_id = s.id and status in ('approved', 'submitted'); end if;
  perform quizbox_core.audit('marketplace.seller', 'mk_sellers', s.id, jsonb_build_object('status', p_status));
  perform public.qb_mk_notify(s.user_id, case when p_status = 'verified' then 'You can now sell question sets' else 'Your seller account changed' end, case when p_status = 'verified' then 'Your seller account is verified.' else left(coalesce(p_note, ''), 200) end, '/seller');
  return jsonb_build_object('ok', true, 'status', p_status);
end $fn$;

-- Finance: the payout queue, with the destination in full (the only place it is shown), and marking a payout paid or rejecting it.
create or replace function public.qb_mk_admin_payouts(p_status text default 'requested') returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_mk_is_staff('finance') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'seller', s.display_name, 'school', s.school_name, 'email', pr.email, 'amount_minor', p.amount_minor, 'gross_minor', p.gross_minor, 'platform_fee_minor', p.platform_fee_minor,
      'refunds_minor', p.refunds_minor, 'sales_count', p.sales_count, 'status', p.status, 'requested_at', p.requested_at, 'due_at', p.due_at, 'overdue', p.status = 'requested' and p.due_at < now(), 'paid_at', p.paid_at, 'transfer_ref', p.transfer_ref,
      'destination', p.destination, 'note', p.decided_note) order by p.due_at)
    from public.mk_payouts p join public.mk_sellers s on s.id = p.seller_id join public.profiles pr on pr.id = s.user_id where p_status is null or p_status = '' or p.status = p_status), '[]'::jsonb);
end $fn$;

create or replace function public.qb_mk_admin_payout_set(p_payout uuid, p_action text, p_ref text, p_note text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare po public.mk_payouts; s public.mk_sellers;
begin
  if not public.qb_mk_is_staff('finance') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  select * into po from public.mk_payouts where id = p_payout for update;
  if po.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if po.status <> 'requested' then raise exception 'QB_PAYOUT_NOT_OPEN' using errcode = '55000'; end if;
  select * into s from public.mk_sellers where id = po.seller_id;
  if p_action = 'paid' then
    if length(btrim(coalesce(p_ref, ''))) < 4 then raise exception 'QB_REFERENCE_REQUIRED' using errcode = '22023'; end if;
    update public.mk_payouts set status = 'paid', paid_at = now(), paid_by = auth.uid(), transfer_ref = left(btrim(p_ref), 80), decided_note = left(coalesce(p_note, ''), 500) where id = po.id;
    perform public.qb_mk_notify(s.user_id, 'Your payout was sent', 'GHS ' || (po.amount_minor / 100.0)::numeric(12, 2)::text || ' was sent to your ' || (po.destination ->> 'network') || ' account. Reference ' || left(btrim(p_ref), 40) || '.', '/seller');
  elsif p_action = 'reject' then
    if length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'QB_REASON_REQUIRED' using errcode = '22023'; end if;
    perform public.qb_mk_payout_release(po.id, 'rejected', p_note, auth.uid());
    perform public.qb_mk_notify(s.user_id, 'Your payout request was not paid', left(p_note, 200) || ' Your money is back in your balance.', '/seller');
  else raise exception 'QB_INVALID_DECISION' using errcode = '22023'; end if;
  perform quizbox_core.audit('marketplace.payout', 'mk_payouts', po.id, jsonb_build_object('action', p_action, 'amount_minor', po.amount_minor));
  return jsonb_build_object('ok', true, 'status', p_action);
end $fn$;

-- The merchant account at a glance: what was paid in, what QuizBox keeps, what is owed to teachers, what has been paid out.
