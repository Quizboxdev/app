-- DEVELOPMENT PLACEHOLDER compensation policy (set 19 October 2026 by the owner so reviewer work can proceed while the system is in development).
-- It mirrors config/reviewer-policy.json: base GHS 0.50 per completed review, plus GHS 0.10 when the review approves; rejection and revision pay the base only.
-- Change it before real payouts: Admin, Compensation, "New policy version" (a new version, never an edit), or edit the numbers below and re-run after
-- deleting this policy. It is clearly named so nobody mistakes it for the final policy. Safe to run twice: it does nothing if the policy exists.
-- Run in the Supabase SQL editor as the database owner.
begin;

insert into public.compensation_policies(name, active)
select 'DEVELOPMENT PLACEHOLDER (not final)', true
 where not exists (select 1 from public.compensation_policies where name = 'DEVELOPMENT PLACEHOLDER (not final)');

insert into public.compensation_policy_versions(policy_id, currency_code, effective_from, base_review_fee, approve_fee, reject_fee, revision_fee, senior_review_fee,
       complexity_multiplier, quality_bonus_amount, minimum_payout_threshold, tax_or_withholding, funded_by, created_by)
select p.id, 'GHS', now(), 0.50, 0.10, 0.00, 0.00, 1.00, 1, 0, 20, '{"percentage": 0}'::jsonb, 'QuizBox (development placeholder)',
       (select user_id from public.user_capabilities where capability = 'super_admin' and active order by created_at limit 1)
  from public.compensation_policies p
 where p.name = 'DEVELOPMENT PLACEHOLDER (not final)'
   and not exists (select 1 from public.compensation_policy_versions v where v.policy_id = p.id);

commit;

select p.name, v.currency_code, v.base_review_fee, v.approve_fee, v.reject_fee, v.revision_fee, v.senior_review_fee, v.minimum_payout_threshold, v.funded_by
  from public.compensation_policies p join public.compensation_policy_versions v on v.policy_id = p.id where p.name = 'DEVELOPMENT PLACEHOLDER (not final)';
