create or replace function public.qb_family_order_create(p_kind text, p_items jsonb, p_idem text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); w uuid; o public.family_orders; it jsonb; sid uuid; n integer; coins bigint; intent jsonb; total bigint := 0; seen uuid[] := '{}'; idx integer := 0; perm text;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  if p_kind not in ('coins', 'subscription') or p_idem is null or char_length(p_idem) not between 8 and 120 or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'QB_FAMILY_INVALID' using errcode = '22023'; end if;
  n := jsonb_array_length(p_items);
  if n < 1 or n > 10 then raise exception 'QB_FAMILY_INVALID' using errcode = '22023'; end if;
  select id into w from public.family_workspaces where owner_user_id = uid;
  if w is null then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  select * into o from public.family_orders where parent_user_id = uid and idempotency_key = p_idem;
  if o.id is not null then return quizbox_core.family_order_json(o.id); end if;
  perm := case p_kind when 'coins' then 'buy_coins' else 'buy_subscription' end;
  for it in select * from jsonb_array_elements(p_items) loop
    begin sid := (it ->> 'student_id')::uuid; coins := (it ->> 'coins')::bigint; exception when others then raise exception 'QB_FAMILY_INVALID' using errcode = '22023'; end;
    if sid is null or coins is null or coins < 1 or coins > 1000 or sid = any(seen) then raise exception 'QB_FAMILY_INVALID' using errcode = '22023'; end if;
    if not quizbox_core.family_can(uid, sid, perm) then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
    seen := seen || sid;
  end loop;
  insert into public.family_orders(parent_user_id, workspace_id, kind, idempotency_key) values (uid, w, p_kind, p_idem) returning * into o;
  for it in select * from jsonb_array_elements(p_items) loop
    idx := idx + 1; sid := (it ->> 'student_id')::uuid; coins := (it ->> 'coins')::bigint;
    intent := public.qb_payment_intent_create(sid, coins, 'GHS', 'paystack', 'mobile_money', left(p_idem, 80) || ':' || sid::text);
    insert into public.family_order_items(order_id, position, beneficiary_user_id, intent_reference, coins, amount_minor) values (o.id, idx, sid, intent ->> 'reference', coins, (intent ->> 'amount_minor')::bigint);
    total := total + (intent ->> 'amount_minor')::bigint;
  end loop;
  update public.family_orders set total_minor = total where id = o.id;
  perform quizbox_core.audit('family.order_create', 'family_orders', o.id, jsonb_build_object('kind', p_kind, 'children', n, 'total_minor', total));
  return quizbox_core.family_order_json(o.id);
end $fn$;
