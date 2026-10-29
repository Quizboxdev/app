# 04. Implementation roadmap

Date: 2026-10-25. Follows the release ordering in the directive (A to H). Where this ordering differs, the reason is stated. Dependencies come first; no dashboard is built before its ledger.

## Ordering decisions

1. **Release C (commercial core) is built before B's school pricing** because the commission engine needs only a settled payment, not a school licence, and Release B's school prices need an owner decision (D-B1) that engineering must not guess. The engine is configured by policy rows, so school sales plug in later without rework.
2. **Release A items that need the owner** (working Preview accounts, Vercel Preview variables) run in parallel and gate *production switch-on*, not coding.
3. Every release ships dark behind a flag, Preview first, with a rollback script.

## Releases

| Release | Scope | Gap rows | Status |
|---|---|---|---|
| A | Foundations: self-contained migration chain; signed-in Playwright smoke suite; Preview builds; legal register; guardian screens | G-01, G-02, G-03, G-04, G-05, G-41, G-42 | G-01 next; G-02, G-03 need owner inputs |
| **C-1** | **Commission policy (versioned), affiliates, referral attribution, commission accrual/reversal wired into `fulfilAfter()`, finance read screens** | **G-27, G-28, G-29, G-30, G-34 (rule) , G-39 (part)** | **Started in this pass: see `14_RELEASE_AND_CHANGELOG.md`** |
| C-2 | Payout requests and finance queue, maker–checker, affiliate dashboard and tiers, subscriber Coins referral | G-31, G-32, G-33, G-40 | Planned |
| B | Schools: verification, licences and seats, teacher bindings, renewals, reports | G-06 to G-11 | Planned; needs D-B1 |
| D | Challenges: templates, recurrence, qualification, verification/appeals, certificates, prize ledger | G-12 to G-16 | Planned |
| E | Sponsorship and legacy: funding, agreements, alumni, living/memorial, sponsor-funded access, impact reports | G-17 to G-22 | Planned; needs D-S1, D-S2 |
| F | Regional growth: territories, CRM, activities, manager commission | G-23 to G-26 | Planned; needs D-C2 |
| G | Marketplace: versioned royalty, publisher types, independence checks | G-35 to G-38 | Planned; needs legal |
| H | Integration: workspaces for commercial roles, notifications, analytics, accessibility, docs | G-43 to G-45 | Planned |

## Release C-1 detail (first increment)

1. Migration `20261048100000_affiliate_commission_foundation.sql` + rollback: `commission_policies`, `affiliates`, `affiliate_payout_details` (closed), `referral_attributions`, `commission_accruals`, `commission_ledger`; flags `flags.affiliates`, `flags.affiliate_payouts`.
2. Functions: policy create/approve (finance), affiliate apply / decide, referral capture (server-side, first-touch), `qb_commission_accrue(reference)`, `qb_commission_reverse(reference, reason)`, `qb_commission_release_holds()`, finance read functions.
3. `lib/payments/settlement.ts`: two idempotent steps after existing fulfilment; failure answers 500 so the provider retries (same pattern as the marketplace step).
4. Tests on the real migration (PGlite) for each negative case in the directive's list: self-referral, duplicate attribution, cap violation, direct balance edit refused, refund after approval, duplicate webhook, minor affiliate, unpaid subscription.
5. Paste parts and copy-list entry via the existing release kit.

## Acceptance gates before any production switch-on

Typecheck, lint, full suite green; migration applied to Preview then fingerprint-matched; flag on in Preview only; Paystack sandbox payment produces exactly one accrual; refund produces one reversal; finance reconciliation shows zero unexplained difference; counsel answers the register items that apply (tax, data protection, payouts).
