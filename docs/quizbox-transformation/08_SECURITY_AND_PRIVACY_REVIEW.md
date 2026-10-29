# 08. Security, safeguarding and privacy review

Date: 2026-10-25. Scope: the existing platform (from the audit) and Release C-1. QuizBox serves minors. This is an engineering review, not legal advice, and no compliance is claimed. Legal questions that need counsel are listed in §6.

## 1. Controls verified in code and tests

| Area | Control | Evidence |
|---|---|---|
| Authentication / sessions | Supabase Auth; password policy for ages 8–18; app shell redirects (convenience); optional server guard built, off | `lib/auth/*`, `docs/security/password-policy.md`, `middleware.ts` |
| Authorisation | RLS on user data; every elevated function pins `search_path` and states grants; a test fails any migration that forgets either | `lib/core/migration-hygiene.test.ts` |
| Payments | HMAC-SHA512 signature, constant-time compare, body cap, server re-query before crediting, idempotent by event id, server-computed price | `lib/payments/paystack.ts`, `payments.test.ts` |
| Child safety | Managed under-13 accounts: no email, cannot pay, blocked features list, automated erasure | `docs/security/UNDER_13_DESIGN.md`, `qb_challenge_active_user` |
| Commissions (new) | Adult-only, staff-verified affiliates; service-role-only accrual; immutable ledger; versioned policy; second approver; cap; no customer identity returned | `lib/core/affiliate-commission-sql.test.ts` (16 tests) |
| Referral link (new) | Cookie carries only a validated 6–12 character code; the database re-validates; first touch wins; self-referral refused | `lib/referral/referral.test.ts` |
| Abuse limits | Per-user call budgets, upload and zip limits, PDF limits | `quizbox_private.enforce_budget`, `lib/uploads/*` |
| Audit | Admin actions, policy approvals (with self-approval flag), affiliate decisions, manual reversals write `audit_logs` | tests assert the audit row |
| Rollback | Functions removable without losing records; payments unaffected | rollback test inside the affiliate suite |

## 2. Threats considered for Release C-1 and how each is handled

| Threat | Handling | Residual risk |
|---|---|---|
| Self-referral (affiliate buys through own code, or has a friend pay for them) | Refused at capture (same user) and at payment (affiliate is payer or beneficiary); attribution marked rejected | Collusion with a real second person paying real money cannot be detected by rules alone: mitigated by the hold period, minimum payout, and manual review of top affiliates |
| Cookie tampering / planting a code | Code is validated and only a hint; DB checks existence, approval status, first touch | An attacker can attribute **themselves** to an affiliate, which only helps that affiliate and still needs a real paid first purchase |
| Code enumeration | 8 hex characters (4.3 billion), invalid and unapproved codes answer the same; 20 attempts per person per hour (and 10 applications per hour), tested | Distributed guessing from many accounts is still possible in theory; each account needs a real sign-up |
| Fake or unpaid subscriptions | Accrual only from `fulfilAfter()` after a successful settlement, and only if the subscription row exists | None known |
| Duplicate webhooks / retries | Unique `(payment_reference, kind)`; repeated calls answer `already_accrued` | None known |
| Refund after commission approved or paid | Explicit reversal row; negative available balance offsets later earnings | Recovering cash already paid out is a contractual matter (terms), not a code matter |
| Direct editing of balances | No table privileges for browser roles; triggers block edits even for the owner; corrections are new rows | A database superuser can drop triggers; mitigated by access control on the Supabase project and the audit trail |
| Rate tampering | Approved policy versions are immutable; each accrual stores the policy it used | None known |
| Privilege escalation to finance | Capability checked inside each function; policy self-approval only by super admin and logged | One person holds all power today (single-owner risk, DILIGENCE risk 7) |
| Child enrolment in a cash programme | Minors and managed learners refused; staff attest identity and age on approval | Learners aged 13–17 are **not** flagged as minors in the data (only managed under-13s are); staff identity verification and the adult attestation are the controls. See decision L-4 |
| Disclosure of customer identity to affiliates | Summary returns counts, amounts, dates only; finance list names affiliates, not customers | Support staff with wider tools can see more (their own scope) |
| Payout destination exposure | Closed table; masked value only; changing details clears verification | Stored unencrypted at rest beyond platform disk encryption (decision S-1) |

## 3. Privacy design rules for the transformation

1. Sponsors, affiliates and regional managers see **aggregates**, never a learner. Where a group could identify a child, a small-group threshold hides the number (planned for sponsor reports, Release E).
2. Photographs and names for legacy programmes need documented consent from the person or family, stored as evidence before publication (Release E).
3. No production secrets, payment credentials or identifiable student records in tests, reports or fixtures. The new tests use synthetic UUIDs and `@example.com` addresses.
4. Data export datasets (31) are staff-only and audited.
5. Retention and deletion: managed learner erasure is automated; commission and payment records are **financial records** and are kept; the rollback removes functions, not records.

## 4. Open security items carried from the audit

CSP report-only (enforce after 2026-10-31 triage); hosted Preview deployments failing; no signed-in end-to-end tests; GitHub branch protection and second code owner not yet set; backup and isolated-restore evidence not recorded; legacy competition tables not defined in the migration chain (rebuild-from-scratch risk).

## 5. Required before the affiliate programme is switched on in production

1. Migration applied on Preview, fingerprint matched, then Production, fingerprint matched.
2. One approved policy version recorded with the owner's name and date.
3. Paystack sandbox payment by a referred test customer produces exactly one accrual; a refund produces exactly one reversal. (**NOT RUN**: no sandbox keys in this environment.)
4. Affiliate terms reviewed by a lawyer (draft text is on the apply screen and says so).
5. Finance confirms tax treatment of commission and withholding (decision F-1).

## 6. Legal questions needing professional determination (Ghana)

1. Data Protection Act, 2012 (Act 843): registration with the Data Protection Commission; lawful basis and notices for processing learners' data; children's data; cross-border processing (Supabase/Vercel regions); sponsor and affiliate access rules.
2. Consumer, advertising and direct-selling rules for an affiliate scheme that pays commission on sales; whether affiliates are agents, independent contractors or neither; any licence needed.
3. Tax: VAT on subscriptions; withholding tax on commissions, royalties and reviewer fees; treatment of QuizBox's marketplace share; invoicing and receipts.
4. Competitions and prizes: gaming and lottery law, chance-based elements, cash or in-kind prize rules, publicity consent for winners who are minors, sponsor-funded prize escrow.
5. E-money / payments: whether holding Coins, sponsor funds or affiliate balances triggers any licensing duty; Paystack's merchant terms for pay-outs.
6. Legacy and memorial programmes: use of a deceased person's name and image; authority of family or estate; living person's consent and withdrawal.
7. Marketplace: copyright and licensing warranties from publishers; liability for third-party content; refund rights.
8. Terms of Use, Privacy Policy, seller terms, affiliate terms and the repository licence (currently a default proprietary notice).
