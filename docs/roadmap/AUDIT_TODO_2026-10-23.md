# Audit remediation to-do list

Prepared 23 October 2026 from [the supplied system audit](../../QuizBox_System_Audit_Development_Recovery_2026-10-23.docx), current source inspection, recent delivery records and read-only public HTTP checks. This is a planning deliverable, not a completed security review or authorization to deploy.

## Important correction to the audit baseline

The audit inspected `hoverconsult/QuizBox`, commit `0fdbe16e6f47ab97b7956c98ad6d03073e78ac95` dated 3 April 2026. This checkout uses `Quizboxdev/app`, HEAD `9f7ace9ec2cb4b63de312a4813da0bed2481f42f` (23 October, Marketplace). The preceding workspace check confirmed that SHA on remote main, but did not establish the production Vercel SHA. Do not copy old repository findings into confirmed production defects.

Current source has Supabase, a Paystack verification and settlement implementation, database-owned subscriptions, public intake forms and CI. No tracked Prisma files were found. Existing implementation does not prove deployment, database parity or authenticated correctness.

Public checks this turn: Privacy, Terms, Sponsor, School, SME and Contact returned HTTP 200. Privacy HTML contains the explicit “being finalized” fallback. Terms did not contain that phrase; its legal completeness was not assessed. All four intake pages contain a form and no “coming soon” marker; submissions were not made. These checks do not prove acknowledgement delivery or storage.

## Priorities and completion rules

P0 = resolve or obtain evidence-backed closure before widening release. P1 = core beta validation and completion. P2 = operational readiness. All checkboxes below are pending, including verification of work already built. Engineering owns implementation and evidence; the owner approves production operations, policy publication, source authority, pricing and compensation.

### P0 — establish the release baseline

#### QB-02 — Prove which application is deployed

Owner: engineering + deployment owner. Status: unresolved deployment identity; first dependency for other runtime checks.

- [ ] Record Vercel project, production domain, source repository, branch, deployment ID, build time and exact deployed SHA; correlate server/API deployment too.
- [ ] Record production database project, applied migration inventory and feature-switch values without secrets or user data.
- [ ] Add safe release metadata (SHA/version/build time) to a diagnostic endpoint or release manifest; do not expose credentials or internal configuration.
- [ ] Attach the CI run for that SHA and record differences from the working checkout, including uncommitted changes.
- [ ] Refresh stale roadmap summaries and release receipts only from new evidence; retain historical reports with their dates.

Done: one release manifest traces public frontend, server routes, database state and CI to the candidate release. HTTP 200 alone is insufficient.

#### QB-01 — Complete public policy publication

Owner: owner/legal reviewer + engineering. Status: policy CMS exists; live Privacy fallback confirmed.

- [ ] Determine whether Privacy is unpublished, missing its migration or failing its public policy RPC; inspect sanitized logs before assuming the cause.
- [ ] Fill Company details and obtain approved Privacy, Terms, Cookies, Refund and seller-policy text covering children/consent, retention/deletion, rewards and marketplace responsibilities.
- [ ] Verify required policy migrations against the release manifest; prepare any missing application steps for owner execution.
- [ ] Owner reviews and publishes approved versions through the existing CMS.
- [ ] Test current and historic policy links, immutable published versions, sign-up acknowledgement, material-change re-acknowledgement and teacher-managed learner consent records.

Done: complete approved public policies and recorded acknowledgements work on the deployed candidate. A non-placeholder Terms page is not legal approval.

Evidence: [Privacy route](../../app/(public)/privacy/page.tsx), [Terms route](../../app/(public)/terms/page.tsx), [policy reader](../../lib/policies/server.ts), [application guide](../release/APPLY_POLICIES.md).

#### QB-03 — Verify CI against the actual architecture

Owner: engineering. Status: old Prisma/file-database mismatch not applicable to inspected checkout; current CI result unverified.

- [ ] Obtain the latest green GitHub Actions run for the release SHA: typecheck, lint, tests, build and production dependency audit.
- [ ] Confirm what PostgreSQL behavior the existing PGlite tests cover; add isolated PostgreSQL/Supabase integration checks for migration replay, grants, RLS and extensions that in-memory tests cannot certify.
- [ ] Rehearse migration application from the supported baseline and record any required production-only objects.
- [ ] Require applicable checks before release and record rollback/redeploy instructions.

Done: green candidate CI plus database integration evidence. Do not introduce Prisma solely to satisfy the obsolete audit instruction.

Evidence: [current workflow](../../.github/workflows/ci.yml).

#### QB-04 — Prove payment and fulfilment correctness

Owner: engineering + payment operator. Status: verification and settlement implemented; audit's stub/hardcoded-email diagnosis is not supported by current inspected paths.

- [ ] Run focused provider, ledger, subscription and Marketplace tests on the candidate; reconcile expected payment amount, GHS currency, reference and beneficiary with stored intent.
- [ ] Exercise valid/invalid signatures, changed payloads, wrong amount/currency/reference, failed payments, provider timeout, duplicate/reordered events and retries after partial fulfilment failure.
- [ ] Explicitly verify what happens when Marketplace fulfilment RPCs are missing or fail: the current settlement code tolerates some missing-function/schema-cache errors. Prove a paid Marketplace purchase cannot be silently left without access.
- [ ] Test full/partial refunds, reversal/chargeback handling, seller clawback after payout and subscription revocation; log unsupported cases as defects rather than assuming coverage.
- [ ] Reconcile test provider transactions to ledger entries, buyer access and seller balances. Obtain sanitized runtime evidence before enabling any new paid product.

Done: signed event -> verified payment intent -> one ledger effect -> correct entitlement; retries recover safely and refunds reconcile. Use provider test mode and test accounts; do not charge users as part of this checklist.

Evidence: [Paystack adapter](../../lib/payments/paystack.ts), [settlement](../../lib/payments/settlement.ts), [payment tests](../../lib/payments/payments.test.ts), [checkout](../../app/api/payments/checkout/route.ts).

### P1 — validate the core beta

#### QB-05 — Verify server-owned subscription access

Owner: engineering. Status: implementation exists; legacy localStorage claim requires no blanket rewrite.

- [ ] Trace subscription and Coin access checks through server/database enforcement, including direct API calls.
- [ ] Test free allowance, paid access, expiry, refund, insufficient Coins and disallowed beneficiary funding.
- [ ] Prove changing localStorage or bypassing the UI cannot grant access; check every premium entry point.
- [ ] Verify pricing cards match server prices and disabled/unavailable products cannot charge.

Done: only verified entitlements grant premium access; user-visible prices and server charges agree.

#### QB-06 — Verify intake end to end

Owner: engineering + support operator. Status: public forms observed; submission and email behavior unverified.

- [ ] Test sponsor, school, SME and general contact with designated test submissions and consent records.
- [ ] Confirm validation, spam/rate controls, file restrictions where offered, reference numbers and safe error states.
- [ ] Verify persistence, acknowledgement delivery, staff queue routing, assignment and resolution.
- [ ] Inventory all public calls to action; fix dead links or misleading transactional promises.

Done: submission -> stored request -> acknowledgement -> actionable staff queue, with no duplicate or leaked requests.

#### QB-07 — Establish content publication evidence

Owner: content lead/SMEs + engineering; source/version decisions remain with owner. Status: governed pipeline exists; full live content audit outstanding.

- [ ] Inventory active curriculum/source IDs, hashes, editions, approval records and rights attestations; identify whether the audit's Draft Zero Computing PDF is actually used.
- [ ] Check current SHS D-17 decision and grade scope against approved records; do not infer B10/SHS eligibility from that draft document.
- [ ] Recheck older open items concerning Agricultural Science and PE Core sibling-PDF mismatches; resolve only if still present.
- [ ] Audit each publishable question for source/page/indicator/version, answer/explanation, cognitive demand, author, reviewer, QA decision and immutable revision history.
- [ ] Report generated, validated, approved and published counts separately, plus indicator/strand coverage, duplicate findings and documented shortfalls.
- [ ] Verify draft/rejected/fixture content cannot reach learners and demonstrate import rollback on isolated data.

Done: only approved, source-supported questions reach learners; unresolved source/version items remain excluded.

Evidence: [curriculum open items](../curriculum/OPEN_ITEMS.md), [development record](PROGRESS.md). These are historical leads to verify, not current database findings.

#### QB-08 — Execute the authenticated regression matrix

Owner: engineering/QA + designated role testers. Status: older acceptance evidence exists; not a test of the latest candidate.

- [ ] Authentication: signup, verification, login/reset, expired sessions and invitations.
- [ ] Learning: grade/subject/topic -> practice -> submission -> explanations -> progress.
- [ ] Classroom: teacher class/assignment -> learner submission -> gradebook reconciliation.
- [ ] SME: authorised assignment -> review/reject/approve -> audit -> controlled publication.
- [ ] School/admin/support: permitted tasks plus denied cross-role and cross-school actions.
- [ ] Challenges/competitions: joining, eligibility, timing, round progression, result privacy, moderation, sponsor reporting and seat limits.
- [ ] Young learners: managed sign-in, consent, reassignment, retention and deletion using isolated records.
- [ ] Repeat core journeys on desktop and phone; check keyboard use, labels, focus, errors and layout.

Done: dated results tied to the release SHA and database baseline, screenshots, zero unresolved P0/P1 defects and explicit cross-tenant negative tests. Do not reuse the older 119-pass receipt as proof for new features.

### P2 — operational readiness

#### QB-09 — Finalise commercial transparency and payout operations

Owner: owner/finance/legal reviewer + engineering. Status: Marketplace ledger and 60/40 split built; activation and operating evidence outstanding.

- [ ] Approve and publish reviewer compensation rules, seller terms, fees, refund rules, minimum payout, 7-day hold and settlement timing.
- [ ] Verify seller approval, item approval, 60/40 rounding, 90-day buyer access and revenue reporting against transaction fixtures.
- [ ] Walk through payout request, exact-amount approval, rejection/cancellation, manual transfer record and refund after payout.
- [ ] Verify role separation and audit logs; ensure public earnings claims match approved rules.
- [ ] Complete the existing Marketplace migration/activation checklist before opening sales. Treat automatic Paystack transfers as a later enhancement, not an already-delivered feature.

Done: owner-approved rules match the ledger, UI and finance process. Payment integrity remains P0 under QB-04 even though this transparency item is P2.

Evidence: [Marketplace guide](../release/APPLY_MARKETPLACE.md).

#### QB-10 — Build the beta QA and operations pack

Owner: engineering/QA + beta coordinator.

- [ ] Prepare role-specific tester guides, mobile/desktop screenshots and safe test-data/reset instructions.
- [ ] Create a defect register with ID, owner, priority, environment/SHA, reproduction, expected/actual result, evidence, fix reference, rollback and retest status.
- [ ] Define release metrics: journey success, errors, payment reconciliation, approved content coverage and unresolved defects; assign thresholds before testing.
- [ ] Attach backup and isolated-restore proof, health checks, p95 latency and mobile-data measurements with explicit workloads/targets.
- [ ] Produce a beta go/no-go sheet signed off against the P0 gates and core regression matrix.

Done: another tester can reproduce results and an operator can diagnose, roll back and restore the release.

## Suggested execution order

1. QB-02: establish actual production identity and candidate baseline.
2. QB-01 and QB-03: close policy publication and CI evidence gaps.
3. QB-04 and QB-05: verify payments and entitlements before new paid-feature activation.
4. QB-06 and QB-07: prove intake and approved content availability.
5. QB-08: run full role/isolation regression on that same candidate.
6. QB-09 and QB-10: finalise operations, QA packet and beta decision.

No application code, deployment, policies, database state, pricing, role grants or payment switches were changed while preparing this list. No GitHub issues were created; this document is the requested local backlog.
