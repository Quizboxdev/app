# 14. Release and changelog

Date: 2026-10-25. Newest first. "Built" means written and tested locally; **nothing in this file has been applied to Preview or Production, committed, or pushed** unless a line says so.

## Release C-1: affiliates, referral attribution and the commission ledger (built, not applied)

**Added**
- Migration `supabase/migrations/20261048100000_affiliate_commission_foundation.sql` and rollback `supabase/rollback/affiliate_commission_foundation.sql`.
  - Tables: `commission_policies`, `affiliates`, `affiliate_payout_details`, `referral_attributions`, `commission_accruals`, `commission_ledger`.
  - Functions: `qb_affiliate_apply/me/payout_save/summary`, `qb_referral_capture`, `qb_commission_accrue/reverse` (service role only), `qb_commission_policies_list/policy_save/policy_approve`, `qb_affiliate_admin_list/decide`, `qb_commission_admin_summary/accruals/reverse`, internal `qb_cm_*`.
  - Settings: `flags.affiliates` (false), `flags.affiliate_payouts` (false). Pilot policy v1 seeded as a **draft**.
  - Paste-ready parts: `docs/release/sql-parts/20261048100000/p1.sql`–`p7.sql`; fingerprint file updated.
- Payment hook: `lib/payments/settlement.ts` calls `qb_commission_accrue` after fulfilment and `qb_commission_reverse` after a refund; a missing function is skipped; any other error answers 500 so the provider retries.
- Screens: `/affiliate` (apply, payout details, link, balances, recent commissions), `/admin/affiliates` (programme switch, applications, commissions ledger and manual reversal, policy versions).
- Link and cookie: `app/r/[code]/route.ts`, `lib/referral/code.ts`, `lib/referral/capture.ts`; attribution is attempted once after sign-in from `components/AppShell.tsx`.
- Client: `lib/api/affiliates.ts`. Server guard list: `affiliate` added to `lib/auth/guard.ts`.
- Navigation: "Affiliates" under Operations for owner, super admin and finance admin. No "Refer and earn" item for ordinary users (controlled pilot; decision P-5).
- Tests: `lib/core/affiliate-commission-sql.test.ts` (17 database tests on the real migration), `lib/referral/referral.test.ts` (7), `lib/api/affiliates.test.ts` (3), two new settlement tests in `lib/payments/payments.test.ts`.

**Changed**
- Nothing existing was removed or altered in behaviour. With the flag off, a payment makes two extra calls that return `programme_off` / `no_attribution`.

**Not changed (on purpose)**
- Payment intent, webhook, fulfilment and marketplace functions; the public pricing page; roles and capabilities tables.

**Open before switching on:** see the gates in `10_DEPLOYMENT_AND_ROLLBACK_PLAN.md` §3 and decisions C-1, F-1, L-2, L-4 in `13_OPEN_DECISIONS_AND_RISKS.md`.

**Rollback:** `supabase/rollback/affiliate_commission_foundation.sql`, flag off, or revert the merge.

## Phase 0 to 4 documentation (written, not committed)

`docs/quizbox-transformation/01_CURRENT_STATE_AUDIT.md` to `15_EXECUTIVE_TRANSFORMATION_SUMMARY.md`. Evidence-based baseline, target architecture, gap matrix (46 rows), release roadmap, contracts, monetisation policy, role matrix, security review, QA report, deployment plan, guides, operations manual, decisions and risks.

## Carried over from earlier work in this branch (not part of the transformation)

Public pricing page "Subscribe" button for priced plans and `/subscribe` as a sign-in return page (local, uncommitted; tests in `components/pricing/PricingCards.test.tsx`, `lib/auth/next-path.test.ts`). The diligence-readiness commit `a511088` is on `release/diligence-readiness-2026-10-25` and has not been merged to `main` as far as the repository shows.

## Next release

C-2: payout requests and the finance queue with a second approver, affiliate dashboard tiers and statements, subscriber referral Coins. Then Release B (school licences) once decision C-4/P-2 is made, and Release A item G-01 (self-contained migration chain) in parallel.
