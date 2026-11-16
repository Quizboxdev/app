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
