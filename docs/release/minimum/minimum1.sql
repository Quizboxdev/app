-- Minimum online charge. Paystack will not take a charge below GHS 5 once fees and taxes are counted, so a payment intent must be at least GHS 5.
-- 1 Coin stays GHS 1.00 (linear: price = Coins x 1). An intent under 5 Coins is refused with QB_BELOW_MINIMUM_CHARGE. Every product on the price list is already GHS 5 or more.
-- The rest of qb_payment_intent_create is unchanged from 20261007100000_core_platform_foundation.sql. Additive and idempotent. Rollback: supabase/rollback/minimum_charge.sql.

create or replace function public.qb_payment_intent_create(p_beneficiary uuid,p_coins bigint,p_currency text,p_provider text,p_method text,p_idem text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare unit bigint; i public.payment_intents; payer uuid:=auth.uid(); min_minor constant bigint := 500;
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
 -- Paystack minimum: GHS 5 (500 pesewas) before fees, checked on the amount being charged.
 if p_coins*unit < min_minor then raise exception 'QB_BELOW_MINIMUM_CHARGE'; end if;
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

notify pgrst, 'reload schema';

