# 15. Executive transformation summary

Date: 2026-10-25. Written for the owner. Facts only; each claim points to a file in this folder.

## In one paragraph

QuizBox is already a working learning, challenge, marketplace and payments platform. Four of the seven target engines have a real base; three do not exist at all (affiliates, regional sales, alumni and legacy sponsorship), and schools cannot yet subscribe as institutions. The first slice of the new commercial core is built and tested locally: **affiliates, referral attribution and a commission ledger**, wired into the one existing payment path, switched off by default, with nothing applied to Preview or Production. The pilot commission policy is only a draft until you approve it.

## Current architecture (what exists)

Next.js 15 / React 19 / TypeScript on Vercel; Supabase Postgres with the business rules as checked SQL functions; Paystack for payments (signed, re-verified, idempotent); about 119 migrations, 112 pages. Details and evidence: `01_CURRENT_STATE_AUDIT.md`.

## Target architecture (what we are building toward)

One identity with capabilities; one money path (`fulfilAfter`) whose consequences are separate ledgers (entitlements, Coins, commissions, royalties, reviewer fees, prizes); policy as versioned data; everything behind flags; minors never in cash programmes. `02_TARGET_ARCHITECTURE.md`.

## Functional gap matrix

46 rows across eight areas. Closest to urgent: G-01 (the migration chain cannot rebuild a database from scratch), G-02 (no signed-in end-to-end tests), G-03 (Preview deployments fail), G-41 (legal register). No outage-level defect was found in authentication, authorisation, payment verification or question integrity. `03_GAP_MATRIX.md`.

## Completed implementations (this pass)

| Item | State |
|---|---|
| Baseline audit with evidence, 23 capability areas classified | Done (`01`) |
| Architecture, gap matrix, roadmap, contracts, policy, roles, security review, plan, guides, operations manual, decisions | Done (`02`–`08`, `10`–`14`) |
| Affiliates, attribution, commission ledger (database, hook, screens, link, tests) | Built and tested locally; **not applied, not committed** |

Counts and results: `09_QA_AND_TEST_REPORT.md`.

## Deferred implementations (and why)

| Item | Why deferred |
|---|---|
| Payouts and finance queue with a second approver | Needs your decisions F-2, F-3 and tax advice; next release (C-2) |
| School licences and seats | Needs prices from you (C-4) and the school verification evidence rule (P-3) |
| Regional manager CRM and commission | Needs the manager rate and agreement (C-2 in the register) |
| Alumni, legacy and memorial programmes, sponsor funding | Need legal answers on consent, naming and funds (L-5, L-6) |
| Competition templates, appeals, certificates, prize ledger | Next after the commercial core; real-cash prizes need counsel (L-3) |
| Marketplace publisher types and royalty versions | After the commission pattern is proven |
| White-label tenancy | Deliberately last; no paying client |

## Financial and security controls now in code

Server-only accrual; first-purchase only, direct referrals only; no self-referral; cap on combined acquisition commission; hold then approval; refunds reverse by explicit rows; immutable ledger even for the table owner; approved policies immutable; second approver for finance; adult-only, staff-verified affiliates; no customer identity shown to affiliates or in the finance list; rate limits on code guessing; renewals blocked by a database constraint. `08_SECURITY_AND_PRIVACY_REVIEW.md`.

## QA evidence

See `09`. In short: the full automated suite and the production build pass; the affiliate engine has 17 database tests against the real migration; the live parts (Paystack sandbox payment, refund, signed-in browser screens) are **NOT RUN** or **BLOCKED** because this environment has no sandbox keys or Preview accounts, and the assistant may not type passwords.

## Deployment status

Nothing from this pass is live. The release steps, undo script and switch-on gates are in `10_DEPLOYMENT_AND_ROLLBACK_PLAN.md`. Order: Preview database → fingerprints → Production database → fingerprints → commit the named files → merge → check → approve policy → switch on.

## Decisions only you can make (top five)

1. Approve (or change) the pilot commission policy: 10 / 12.5 / 15 %, 30-day hold, 15 % cap (C-1).
2. Tell your accountant to confirm the tax share inside prices and withholding on commissions (F-1, F-2).
3. Have a lawyer review the affiliate terms and the age rule for affiliates (L-2, L-4).
4. Give working Preview accounts and Paystack test keys so the money flow can be tested end to end (S-2, S-6).
5. Choose the school licence model and prices (P-2, C-4) so Release B can start.

Full register: `13_OPEN_DECISIONS_AND_RISKS.md`.

## Recommended next release

**C-2:** payout requests and a finance queue with maker–checker, affiliate statements and tiers, subscriber referral Coins, plus **G-01** (self-contained migrations) in parallel. Then **B:** school licences, once the model and prices are decided.

## What this pass did not do

It did not apply anything to a database, did not commit or push, did not switch any flag, did not run a live payment, and did not open signed-in screens in a browser. It did not change the pricing, the marketplace split, any existing payment function, or any decision the owner has already recorded.
