-- Rollback for 20261032100000_minimum_charge.sql: restores the earlier qb_payment_intent_create (no minimum). Re-apply 20261007100000_core_platform_foundation.sql's
-- definition by running its qb_payment_intent_create block, or simply re-apply the core migration's function (it is `create or replace` safe).
-- Nothing else is removed: no data is changed.
begin;
create or replace function public.qb_payment_intent_create(p_beneficiary uuid,p_coins bigint,p_currency text,p_provider text,p_method text,p_idem text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare unit bigint; i public.payment_intents; payer uuid:=auth.uid();
begin
 if payer is null then raise exception 'QB_AUTH_REQUIRED'; end if;
 if not quizbox_core.flag('flags.buy_coins_enabled') then raise exception 'QB_FEATURE_DISABLED'; end if;
 if p_provider is null or not (quizbox_core.setting('payments.providers') ? p_provider) then raise exception 'QB_PROVIDER_NOT_ENABLED'; end if;
 if p_coins is null or p_coins<=0 then raise exception 'QB_INVALID_AMOUNT'; end if;
 if payer=p_beneficiary then
  if not quizbox_core.flag('flags.student_self_pay') then raise exception 'QB_SELF_PAY_DISABLED'; end if;
 elsif not quizbox_core.relationship_allows(payer,p_beneficiary,'can_fund') then raise exception 'QB_FUNDING_NOT_PERMITTED'; end if;
 if not exists(select 1 from public.profiles where id=p_beneficiary and lower(status::text)='active') then raise exception 'QB_INVALID_BENEFICIARY'; end if;
 unit:=(quizbox_core.setting('coins.unit_price_minor')->>p_currency)::bigint;
 if unit is null or unit<=0 then raise exception 'QB_PRICING_NOT_CONFIGURED'; end if;
 select * into i from public.payment_intents where payer_user_id=payer and idempotency_key=p_idem;
 if found then
  if i.beneficiary_user_id<>p_beneficiary or i.coins<>p_coins or i.currency_code<>p_currency or i.provider<>p_provider then raise exception 'QB_IDEMPOTENCY_CONFLICT'; end if;
  return to_jsonb(i);
 end if;
 insert into public.payment_intents(idempotency_key,payer_user_id,beneficiary_user_id,provider,method,currency_code,amount_minor,coins,expires_at)
 values(p_idem,payer,p_beneficiary,p_provider,p_method,p_currency,p_coins*unit,p_coins,now()+interval '30 minutes') returning * into i;
 perform quizbox_core.audit('payment.intent','payment_intents',i.id,jsonb_build_object('beneficiary',p_beneficiary,'coins',p_coins));
 return to_jsonb(i);
end $$;
commit;
