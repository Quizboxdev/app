# 13. Open decisions and risks

Date: 2026-10-25. Every row is something engineering must **not** decide alone. "Safe default" is what the code does until the owner decides; it never activates money movement. Existing decisions recorded earlier (D-17 SHS curriculum identity = GH-SHS-2023, decided by the owner on 2026-10-13; D-18 Primary; D-16 JHS/SHS identities) are respected and not reopened.

## A. Commercial decisions

| ID | Decision | Needed by | Recommendation | Safe default in code |
|---|---|---|---|---|
| C-1 | Approve a commission policy version (rates 10 / 12.5 / 15, cap 15 %, hold 30 days, window 30 days, minimum payout GHS 50) | Before the affiliate flag is switched on | Approve the pilot values for a 3-region pilot (Greater Accra, Ashanti, Central), review after 90 days | Pilot policy is a **draft**; nothing accrues |
| C-2 | Regional manager commission rate and whether it is on collected revenue only | Release F | Collected, verified revenue only; manager rate set so affiliate + manager ≤ 15 % | Not built |
| C-3 | Does a subscriber-referral Coin reward replace or add to a cash affiliate commission when the referrer is both? | Release C-2 | One reward per referred purchase per referrer; cash wins for approved affiliates | Not built |
| C-4 | Final subscription prices for schools, bundles and sponsor-funded access | Release B | Set in the admin price list; engineering will not hard-code illustrative prices | School plan shows "Talk to us" |
| C-5 | Marketplace royalty percentage and per-publisher-type rates | Release G | Keep 60 / 40 for teachers; separate rates for SMEs and institutions | 60 / 40 setting |
| C-6 | SME reviewer fee levels | R5 | Owner sets; engine already reads policy versions | Admin setting |
| C-7 | Sponsorship management fee and platform share of sponsor funds | Release E | Separate line, disclosed in the agreement; never taken from prize money | Not built |

## B. Finance and tax

| ID | Decision | Recommendation | Safe default |
|---|---|---|---|
| F-1 | Tax share inside the subscription price (VAT / levies) removed before commission is calculated | Accountant to confirm the exact rate and whether prices are tax-inclusive | **0 %**: commission is on the full amount until decided (policy field `tax_percent`) |
| F-2 | Withholding on commissions, royalties, reviewer fees; affiliate tax identification at payout | Accountant; collect TIN at payout approval | No payouts built yet |
| F-3 | Payout method, schedule and approval threshold for a second approver | Monthly, by hand, second approver above GHS 1,000 | Payout release (C-2) not built |
| F-4 | Whether commission may be held against refunds already paid out (clawback) | Contract clause plus negative-balance offsetting (already in code) | Negative available balance offsets later earnings |

## C. Legal (counsel required)

| ID | Question | Why it blocks |
|---|---|---|
| L-1 | Data Protection Commission registration and notices (Act 843), children's data, cross-border hosting | Before any broad launch |
| L-2 | Affiliate agreement: status (agent / contractor), disclosures, prohibited marketing claims | Before the affiliate flag goes on; draft terms on the apply screen say "draft" |
| L-3 | Prize, competition and chance-based promotion rules; cash prizes; winners who are minors | Before `kind = 'cash'` prizes or sponsor prize money |
| L-4 | Age of affiliates: learners aged 13–17 are not flagged as minors in the data; is "18+ attested + staff-verified ID" enough? | Before opening applications widely |
| L-5 | Legacy and memorial programmes: consent, family or estate authority, photographs | Before Release E legacy pages |
| L-6 | Whether holding Coins, sponsor funds or affiliate balances needs a payments / e-money licence | Before sponsor funding or wallet-style features |
| L-7 | Marketplace: seller terms, copyright warranties, tax on QuizBox's share | Before the marketplace flag is switched on |
| L-8 | Repository licence and Terms of Use text | Diligence |

## D. Security and operations (owner)

| ID | Item | Safe default |
|---|---|---|
| S-1 | Encrypt payout account numbers at rest (application-level) and set a retention rule | Closed tables, masked output |
| S-2 | Working Preview accounts and Vercel Preview environment variables so signed-in end-to-end tests can run | Signed-in journeys stay BLOCKED |
| S-3 | GitHub branch protection, second code owner, security mailbox | Documented; owner action |
| S-4 | Backup and isolated-restore evidence | Gate stays NOT READY |
| S-5 | Enforce the Content Security Policy after 2026-10-31 triage | Report-only |
| S-6 | Paystack sandbox keys on Preview for payment end-to-end tests | Mocked provider only |

## E. Product

| ID | Decision | Recommendation |
|---|---|---|
| P-1 | Who can be a marketplace publisher beyond verified teachers (SMEs, institutions) | Add after royalty policy versioning (Release G) |
| P-2 | School licence model: per-school licence, per-learner seats, or both; billing periods | Seat limit plus licence period; annual default; term and monthly optional |
| P-3 | Verification evidence for schools and for alumni / legacy coordinators | GES / EMIS number and a signed authority letter |
| P-4 | Guardian screens priority (data model exists, no UI) | Release B, before school sales to primary schools |
| P-5 | Navigation: when to show "Refer and earn" to everyone | After the first approved pilot cohort; until then affiliates get a direct link |

## F. Risk register

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R-1 | Commission paid on a payment later refunded | Medium | Medium | Hold period; explicit reversals; negative balance offset | Engineering (done), Finance |
| R-2 | Affiliate collusion (friends buying through own links) | Medium | Medium | Hold, minimum payout, review of top earners, first-purchase only | Finance |
| R-3 | A child joins a cash programme | Low | High | Adult checks, staff ID verification, decision L-4 | Owner, counsel |
| R-4 | Cap breached when manager commissions arrive | Low | Medium | Cap is enforced at accrual; property tests in Release F | Engineering |
| R-5 | Hidden dependency on legacy tables breaks disaster recovery | Medium | High | G-01 migration that creates them; scratch rebuild test | Engineering |
| R-6 | No signed-in end-to-end tests: regressions go unnoticed | High | High | Seed Preview accounts; Playwright smoke in CI | Owner then engineering |
| R-7 | Single-person knowledge and approval power | High | Medium | Second code owner and second finance approver | Owner |
| R-8 | Payment code and migration deployed in the wrong order | Medium | Medium | Code treats "function not found" as nothing to do; release plan applies database first | Engineering (done) |
| R-9 | Scope: seven engines is a multi-month programme | Certain | Medium | Release plan in dependency order; each release ships dark behind a flag | Product |
