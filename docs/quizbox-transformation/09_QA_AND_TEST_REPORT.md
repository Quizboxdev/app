# 09. QA and test report

Date: 2026-10-25. Every result is **PASS**, **FAIL**, **BLOCKED** or **NOT RUN**, with the reason. Nothing is estimated or assumed. "Database test" means the real migration run on an embedded PostgreSQL (PGlite) with browser roles simulated; it proves the rules in the database, not the live Supabase project.

## 1. Build health (this session)

| Check | Command | Result |
|---|---|---|
| Baseline before any change | `npx vitest run` | PASS: 1,483 passed, 119 skipped, 0 failed |
| Type check (strict) | `npx tsc --noEmit` | **PASS**, exit 0 (after all changes) |
| Lint | `npx eslint .` | **PASS**, exit 0 |
| Full suite after all changes | `npx vitest run` | **PASS**: 180 files passed, 6 skipped; **1,512 passed, 119 skipped, 0 failed** |
| Production build | `npx next build` | **PASS**, exit 0; `/affiliate`, `/admin/affiliates` and `/r/[code]` are in the route table |

Note: one earlier full run showed timeouts in database-test setup and one real failure. The timeouts happened because several test runs shared the machine; the real failure (the server-guard section list) was fixed. The clean run above was made with nothing else running. The 119 skipped tests are the live-acceptance files that need a signed-in Preview project.

## 2. Release C-1: negative cases from the directive's list

| Directive case | Result | Evidence |
|---|---|---|
| Forged payment confirmation | PASS (existing) | `payments.test.ts`: bad signature answers 400 and changes nothing; `qb_commission_accrue` cannot be called by a browser role (permission denied) |
| Duplicate webhook delivery | PASS | accrue twice → `already_accrued`, one accrual row; settlement test shows the commission step runs with the retry |
| Affiliate self-referral | PASS | capture by the affiliate → `self_referral`, no attribution row; a referred customer paying *for* the affiliate → `self_referral`, attribution rejected, no accrual |
| Duplicate referral ownership | PASS | second code from another affiliate → `already_attributed`; first affiliate keeps the customer |
| Commission cap violation | PASS | policy rate 20 % vs cap 15 % on GHS 40: commission 600 not 800; 200 recorded as clipped; amount ≤ cap |
| Unauthorised payout | NOT RUN | payouts are not built (C-2); no function moves money out |
| Direct editing of financial balances | PASS | browser insert/update on the ledger → permission denied; table-owner update/delete → `QB_LEDGER_IMMUTABLE`; accrual amount edit → `QB_ACCRUAL_IMMUTABLE`; approved policy edit → `QB_POLICY_IMMUTABLE` |
| Access to another organisation's information | PASS (affiliate scope) | summary uses the caller's id only; one affiliate's numbers differ from another's; affiliate calling the finance summary → `QB_FORBIDDEN`; no customer id or email appears in affiliate or finance output |
| Unapproved child cash withdrawal / child in cash programme | PASS | minor and teacher-managed learner → `QB_ADULTS_ONLY`; no withdrawal exists |
| Refund after commission approval | PASS | approved commission reversed → available falls by the amount; after a simulated payout the available balance goes negative (owed back) |
| Failed or interrupted settlement | PASS | commission step failing with a real error → webhook answers 500 (provider retries); the step is idempotent; function-not-found → customer payment unaffected |
| Unapproved question publication, sponsor manipulation of results, competition access after closure, expired sponsored entitlement, unauthorised teacher assignments | NOT RUN (not changed by C-1) | covered by existing suites for current behaviour (`challenges-*`, `competitions-sql`); the sponsor-funded and school-licence cases arrive in Releases B and E |

## 3. Release C-1 database suite, test by test

`lib/core/affiliate-commission-sql.test.ts`

1. Re-applies cleanly; closed to every browser role; accrue/reverse not callable by browsers. **PASS**
2. Off until the flag is on; the pilot policy is a draft; no accrual without an approved policy; `programme_off` when switched off. **PASS**
3. Only adults with ordinary accounts can apply; attestation and terms required; invalid phone refused; double apply is one application. **PASS**
4. Approval needs staff, an identity check and payout details; account never returned in full; changing details clears verification; invalid transitions refused. **PASS**
5. Policy versions validated; second approver required for finance; owner self-approval audited; approved versions immutable; renewals cannot be enabled; non-staff refused. **PASS**
6. Attribution: invalid code, self-referral, first touch wins, code normalisation, existing customer, suspended affiliate gains nothing. **PASS**
7. Accrual once per first eligible paid subscription; not for unsettled, Coins, unfulfilled or repeat purchases; not-found raises. **PASS**
8. Referred customer paying for the affiliate earns nothing. **PASS**
9. Rate limit: 20 code tries an hour per person. **PASS**
10. Payment after the attribution window earns nothing. **PASS**
11. Tiers rise with paid referrals; cap clips. **PASS**
12. Net-of-tax base and policy version kept on the accrual. **PASS**
13. Hold released once; affiliate sees counts and amounts, never customers. **PASS**
14. Refund reverses held, approved and paid commissions explicitly. **PASS**
15. Ledger and records immutable. **PASS**
16. Finance tie-out: every accrual's ledger rows sum to its amount (or zero once reversed); totals match. **PASS**
17. Rollback removes functions, keeps records, payments unaffected, can be re-applied. **PASS**

Other new tests: `lib/referral/referral.test.ts` (code format, cookie, the `/r/CODE` link, capture once, retry on failure), `lib/api/affiliates.test.ts` (plain-language errors, exact RPC arguments), `lib/payments/payments.test.ts` (accrue after fulfilment and only then, reverse on refund, skip when function missing, 500 on real failure).

## 4. Scenarios from the directive (Phase 6)

| # | Scenario | Backend tests | Browser | Status |
|---|---|---|---|---|
| 1 | School acquired by regional manager | none (manager and school licence not built) | none | NOT BUILT |
| 2 | Affiliate introduces a school | affiliate half only | none | NOT BUILT (school licence, manager split) |
| 3 | Subscriber referral Coins | none | none | NOT BUILT (C-2) |
| 4 | Alumni sponsor competition | none | none | NOT BUILT |
| 5 | Legacy competition | none | none | NOT BUILT |
| 6 | Corporate regional championship | none | none | NOT BUILT |
| 7 | Marketplace sale | existing `marketplace-sql.test.ts` (sale, split, hold, refund, payout) | none | PASS at database level; BLOCKED in browser |
| 8 | SME review | existing review pool suites | none | PASS at database level; BLOCKED in browser |
| 9 | Sponsor-funded school subscription | none | none | NOT BUILT |
| 10 | Multi-role user | affiliate numbers visible only to their owner (database) | none | PARTIAL; workspace switching for commercial roles not built |

Affiliate end-to-end (referral link → sign-up → Paystack test payment → commission → refund → reversal) is documented as the intern script in `11_PRODUCT_USER_GUIDES.md` §3: **NOT RUN** (no Paystack sandbox keys and no Preview accounts available to the assistant).

## 5. Browser, accessibility and performance

| Check | Result | Reason |
|---|---|---|
| New screens `/affiliate`, `/admin/affiliates` rendered in a browser | BLOCKED | no signed-in session available; screens compile in the production build and pass type check and lint |
| Responsive layout and accessibility of the new screens | NOT RUN | same; they use the existing form and table classes, labelled inputs, `role="alert"`/`status` messages and `role="tablist"` |
| Axe sweep of public pages | PASS (earlier, 2026-10-24, 34 pages) | `docs/ux-audit/12_QA_REGRESSION_REPORT.md`; no public page changed in C-1 |
| Performance numbers for C-1 | NOT RUN | none claimed |

## 6. Regression

The existing suites (payments, marketplace, challenges, migration hygiene, release kit, guard rules) run in the full suite above. One real regression was caught and fixed during this work: the server-guard coverage test failed until the new `/affiliate` section was added to its list (`lib/auth/guard.ts`).

## 7. Known test limits

Database tests cannot prove the live project's grants or the legacy tables; the fingerprint after applying the migration does (`docs/release/db_fingerprint_*.sql`). Mocked Paystack proves our handling, not Paystack's behaviour. No load test has been run.
