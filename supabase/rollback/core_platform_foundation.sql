-- Rollback for 20261007100000_core_platform_foundation (provenance: quizbox.ransford.eddy.mensah).
-- Refuses once any money/relationship/consent data exists; use the verified backup beyond that.
begin;
do $$ begin
 if exists(select 1 from public.coin_transactions) or exists(select 1 from public.payment_intents) or exists(select 1 from public.account_relationships)
  or exists(select 1 from public.qpoint_transactions) or exists(select 1 from public.learner_consent) then
  raise exception 'QB_ROLLBACK_REFUSED: wallet/payment/relationship/consent data exists';
 end if;
end $$;
drop view if exists public.qpoint_balances;
-- public.entitlements (marketplace) and public.notification_deliveries are pre-existing hosted tables and are never dropped here.
drop table if exists public.learner_consent,public.user_streaks,public.user_badges,public.badge_definitions,public.qpoint_transactions,
 public.payment_events,public.payment_intents,public.access_entitlements,public.coin_transactions,public.wallets,public.user_workspace_context,public.account_relationships,public.platform_settings cascade;
alter table public.notifications drop column if exists category;
alter table public.attempts drop column if exists sync_status, drop column if exists client_updated_at;
alter table public.responses drop column if exists sync_status;
drop function if exists public.qb_setting_set(text,jsonb,text,uuid),public.qb_relationship_allows(uuid,text),public.qb_relationship_request(uuid,text,boolean,boolean),
 public.qb_relationship_decide(uuid,text,jsonb),public.qb_my_roles(),public.qb_switch_workspace(text,uuid,text),public.qb_wallet_adjust(uuid,text,bigint,text,text),
 public.qb_payment_intent_create(uuid,bigint,text,text,text,text),public.qb_payment_apply_event(text,text,text,text,text,bigint,text,boolean,jsonb),
 public.qb_payment_reconcile(uuid,text,text),public.qb_qpoints_award(uuid,text,text),public.qb_consent_set(uuid,text,text),public.qb_feature_allowed(text);
drop function if exists public.qb_coin_spend(uuid,bigint,text,text,text,jsonb);
-- Restore the two pre-existing objects this migration replaced (bodies from 20261006120000 and 20261004110000).
create or replace function quizbox_ops.analytics_student(p_student uuid) returns uuid language plpgsql stable security definer set search_path='' as $$
declare v uuid:=coalesce(p_student,auth.uid());
begin
 if auth.uid() is null or (v<>auth.uid() and not quizbox_sme.has_capability('super_admin')) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 return v;
end $$;
drop function if exists public.qb_student_insights(uuid);
create function public.qb_student_insights() returns jsonb language sql stable security definer set search_path='' as $$ select quizbox_ops.student_insights(auth.uid()); $$;
revoke execute on function public.qb_student_insights() from public,anon;
grant execute on function public.qb_student_insights() to authenticated;
drop schema if exists quizbox_core cascade;
-- user_capabilities keeps the widened check constraint (superset; harmless).
commit;
