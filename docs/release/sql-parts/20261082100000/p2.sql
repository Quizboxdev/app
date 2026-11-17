create or replace function public.qb_family_order_apply(p_provider text, p_event_id text, p_reference text, p_status text, p_provider_reference text, p_amount_minor bigint, p_currency text, p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare o public.family_orders; ev uuid; i record; r jsonb; v_out text;
begin
  select * into o from public.family_orders where reference = p_reference for update;
  if o.id is null then return jsonb_build_object('outcome', 'unknown_reference'); end if;
  insert into public.payment_events(provider, provider_event_id, reference, reported_status, signature_verified, payload)
  values (p_provider, p_event_id, p_reference, p_status, true, coalesce(p_payload, '{}'::jsonb)) on conflict (provider, provider_event_id) do nothing returning id into ev;
  if ev is null then return jsonb_build_object('outcome', 'duplicate_event'); end if;
  if p_status = 'successful' then
    if o.status in ('paid', 'fulfilled') then v_out := 'already_settled';
    elsif p_amount_minor is distinct from o.total_minor or p_currency is distinct from 'GHS' then
      update public.family_orders set status = 'mismatch' where id = o.id; v_out := 'amount_mismatch';
    else
      for i in select * from public.family_order_items where order_id = o.id order by position loop
        r := public.qb_payment_apply_event(p_provider, p_event_id || ':' || i.position, i.intent_reference, 'successful', coalesce(p_provider_reference, p_event_id) || ':' || i.position, i.amount_minor, p_currency, true, coalesce(p_payload, '{}'::jsonb));
        if r ->> 'outcome' not in ('credited', 'already_settled', 'duplicate_event') then raise exception 'QB_ORDER_ITEM_%', r ->> 'outcome'; end if;
      end loop;
      update public.family_orders set status = 'paid', paid_at = now(), provider_reference = p_provider_reference where id = o.id;
      v_out := 'credited';
    end if;
  elsif p_status in ('refunded', 'reversed') then
    for i in select * from public.family_order_items where order_id = o.id order by position loop
      perform public.qb_payment_apply_event(p_provider, p_event_id || ':' || i.position, i.intent_reference, p_status, null, i.amount_minor, p_currency, true, coalesce(p_payload, '{}'::jsonb));
    end loop;
    update public.family_orders set status = 'refunded' where id = o.id; v_out := p_status;
  elsif p_status in ('failed', 'cancelled', 'expired') then
    if o.status = 'initiated' then
      for i in select * from public.family_order_items where order_id = o.id order by position loop
        perform public.qb_payment_apply_event(p_provider, p_event_id || ':' || i.position, i.intent_reference, p_status, null, null, null, true, coalesce(p_payload, '{}'::jsonb));
      end loop;
      update public.family_orders set status = 'failed' where id = o.id;
    end if;
    v_out := 'status_updated';
  else v_out := 'status_updated';
  end if;
  update public.payment_events set outcome = v_out where id = ev;
  return jsonb_build_object('outcome', v_out);
end $fn$;

create or replace function public.qb_family_order_fulfil(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare o public.family_orders; i record;
begin
  select * into o from public.family_orders where reference = p_reference for update;
  if o.id is null then raise exception 'QB_NOT_FOUND'; end if;
  if o.status not in ('paid', 'fulfilled') then return jsonb_build_object('outcome', 'not_settled'); end if;
  if o.kind = 'subscription' then
    for i in select * from public.family_order_items where order_id = o.id order by position loop perform public.qb_fulfil_subscription_payment(i.intent_reference); end loop;
  end if;
  update public.family_orders set status = 'fulfilled', fulfilled_at = coalesce(fulfilled_at, now()) where id = o.id;
  return jsonb_build_object('outcome', 'fulfilled');
end $fn$;

create or replace function public.qb_family_order_revoke(p_reference text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare o public.family_orders; i record;
begin
  select * into o from public.family_orders where reference = p_reference for update;
  if o.id is null then raise exception 'QB_NOT_FOUND'; end if;
  if o.kind = 'subscription' then
    for i in select * from public.family_order_items where order_id = o.id order by position loop perform public.qb_revoke_subscription_payment(i.intent_reference, p_reason); end loop;
  end if;
  return jsonb_build_object('outcome', 'revoked');
end $fn$;

create or replace function public.qb_family_order_get(p_reference text) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); o uuid;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  select id into o from public.family_orders where reference = p_reference and parent_user_id = uid;
  if o is null then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  return quizbox_core.family_order_json(o);
end $fn$;

create or replace function public.qb_family_orders() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(quizbox_core.family_order_json(x.id) order by x.created_at desc) from (select id, created_at from public.family_orders where parent_user_id = uid order by created_at desc limit 30) x), '[]'::jsonb);
end $fn$;

create or replace function public.qb_family_wallets() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('student_id', r.target_user_id, 'name', p.full_name,
      'coins', coalesce(w.purchased_balance, 0) + coalesce(w.promotional_balance, 0),
      'plan', s.plan, 'valid_until', s.valid_until,
      'can_buy_coins', coalesce((r.permissions ->> 'buy_coins')::boolean, false), 'can_buy_subscription', coalesce((r.permissions ->> 'buy_subscription')::boolean, false)) order by p.full_name)
    from public.account_relationships r join public.family_workspaces fw on fw.id = r.family_workspace_id and fw.owner_user_id = uid
    join public.profiles p on p.id = r.target_user_id left join public.wallets w on w.user_id = r.target_user_id
    left join lateral (select ls.plan, ls.valid_until from public.learner_subscriptions ls where ls.user_id = r.target_user_id and ls.status = 'active' and ls.valid_until > now() order by ls.valid_until desc limit 1) s on true
    where r.source_user_id = uid and quizbox_core.family_can(uid, r.target_user_id, 'view_progress')), '[]'::jsonb);
end $fn$;

revoke all on function quizbox_core.family_order_json(uuid) from public, anon, authenticated;
revoke all on function public.qb_family_order_create(text, jsonb, text), public.qb_family_order_apply(text, text, text, text, text, bigint, text, jsonb), public.qb_family_order_fulfil(text), public.qb_family_order_revoke(text, text),
  public.qb_family_order_get(text), public.qb_family_orders(), public.qb_family_wallets() from public, anon, authenticated;
grant execute on function public.qb_family_order_create(text, jsonb, text), public.qb_family_order_get(text), public.qb_family_orders(), public.qb_family_wallets() to authenticated;


notify pgrst, 'reload schema';
