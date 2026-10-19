# QuizBox: system audit and completion plan

- **Date:** 18 October 2026
- **For:** Ransford Mensah (owner) and anyone reviewing the plan with him
- **Basis:** the repository on branch `release/public-homepage-hardening` (main at `6d1400e`), the tracker `docs/roadmap/PROGRESS.md`, the production checks run this week, and the Extension Blueprint v1.0.
- **Status:** proposal for review. Nothing in this document has been built yet unless the audit tables say so.

---

## 1. Summary

QuizBox has a strong, well-tested core: 929 automated tests, server-enforced rules for every sensitive action, a governed curriculum and question pipeline, and working journeys for learners and teachers. It is **not yet a finished system**, for five reasons:

1. **Nobody knows exactly what is in the production database.** This week a migration failed because the production database has no `quizbox_core` schema, which the repository assumes exists. Several migrations were applied by hand, some never. Every later change carries that risk until production and the repository match.
2. **Learners cannot see real questions yet.** The first 1,000 generated questions are loaded but not approved. The owner-approval step was fixed this week and is ready to run.
3. **Several journeys are only partly built:** subscription and payment, the admin and support console, reviewer onboarding and pay, school administration and notifications.
4. **Security basics are missing at the web layer.** There are no security headers, leaked-password protection is off, and the grant clean-up (tracker C6) is still open.
5. **Mobile is responsive in places but not designed for phones,** and there is no app-ready API contract yet.

**The plan:** seven phases on one critical path, with security running alongside from day one. Each phase ends at a gate with written evidence. Work proceeds without you except for the items on one **owner action sheet** (section 8), which are things only you can do: passwords, dashboard switches, contracts, prices and legal text.

| Phase | Outcome | Depends on | Owner input needed |
|---|---|---|---|
| 0. Production truth | Production schema matches the repository; backups proven | DB connection string | Pooler password (once) |
| 1. Questions reach learners | Approved questions live for B4–B9 core subjects; steady weekly loads | Phase 0 (partly) | Read a sample per batch |
| 2. Core journeys complete | Learner, teacher, school, admin and support journeys pass end-to-end tests | Phase 0 | None |
| 3. Security hardening | Headers, grants, RLS audit, monitoring, incident runbook; external test | Starts now, finishes with Phase 2 | Two dashboard switches |
| 4. Mobile and app-ready | Phone-first UI, installable web app, a stable API for a native app | Phase 2 | App store accounts (later) |
| 5. Revenue | Subscription gate on; payments through one provider | Phases 0, 2 | Provider choice, prices, allowance |
| 6. Reviewer workforce | Teachers apply as reviewers; reviewers replace owner approvals | Phases 1, 2 | Reviewer fees |
| 7. Evolution | Challenges (blueprint) and new markets | Gate 2 | Go-ahead |

---

## 2. Audit: who the system serves and how far each journey works

Status legend: **Works** = built and used; **Partial** = built but incomplete or unverified on production; **Missing** = not built.

| User | Journey | Status | Evidence and gap |
|---|---|---|---|
| Visitor | Home page, live figures, join pages, contact | Works | Live figures and section switches in `config/public-visibility.json`. Privacy and terms are placeholders. |
| Learner | Sign up, choose grade, onboard | Partial | Built. Real sign-up with the new password flow not yet proven (tracker A10). |
| Learner | Practise: subject, random or topics, count, start | Works | Rebuilt this month, scoped to the learner's grade. Empty until questions are approved. |
| Learner | Assignments, results, progress | Partial | Built. Not re-verified since recent migrations (tracker G2). |
| Learner | Subscribe when the free allowance runs out | Partial | Gate and `/subscribe` built. The gate depends on the missing `quizbox_core` schema and cannot switch on. No payment. |
| Teacher | Classes, assignments (incl. by topic), gradebook, submissions | Partial | Built. Live acceptance not re-run (G2). |
| Teacher | Practise as a teacher | Partial | Grade chooser built. Starting an attempt as a teacher not verified. |
| School admin | Classes, teachers, learners, performance | Partial | Pages exist. Not in a verified end-to-end test. |
| Under-13 learner | Teacher-managed account, no email | Missing | Needs a decision on consent (tracker G8, D-3). |
| Reviewer (SME) | Apply, get domains, review queue, earnings | Partial | Queue and policy page built. No application flow, no fees set, coverage 0 (D7, R5–R8). |
| Sponsor | Request a competition, see analytics | Partial | Engine built, self-service switched off by decision (F8). Request form missing (S1–S3). |
| Admin (owner) | Markets, curricula, sources, structure, question loading | Works | Used this week in production. |
| Admin (owner) | Approve a question batch | Partial | Built and tested in isolation. First production run pending. |
| Support staff | Delegated catalogue and reviewer management | Partial | `sme_support` capability built. Support ticket screen exists but has no ticket source. |
| Admin and support | Account lookup, audit trail, failure monitoring, error alerts | Partial | Operations page exists. No error monitoring or alerting service (G9). |

**Tracker totals today:** 33 done, 4 in progress, 48 to do, 2 blocked, 9 deferred.

---

## 3. Audit: content orchestration (generation to learner)

The chain is: generator agents, then the bank checker, then the loader, then approval, then the practice builder.

| Step | Status | Finding |
|---|---|---|
| Packs (643 packs, 285,600 questions at 50 per indicator) | Works | `scripts/question-bank/make_packs.py`; work split over 8 accounts. |
| Generation | Partial | Quality is high. Volume is the constraint: one agent wrote about 700 questions an hour when running, and only one account has produced work so far (1,100 questions). |
| Bank checker | Works | Rejects duplicates, misaligned difficulty, curriculum-header questions and unquoted sources. Assigns correct letters without a pattern. It caught two real defects this week (patterned letters, the longest option being the answer too often). |
| Loader | Works | The first real file passed: 1,000 of 1,000 quotes found word for word in the PDF; 0 errors. |
| Approval | Partial | Owner-approved batch fixed for production this week; first run pending. SME routing (L6) not built. |
| Learner view | Partial | Topic names come from the curriculum. Two old curricula (GH-CCP-2020, GH-SOURCE) are still active and may show duplicate subjects. |

**Gaps to close:** a "delta" file so each load contains only new questions (today's bank files are cumulative); a way to track generation progress across all 8 accounts; and fixes for the 34 weak rows flagged in the first file.

---

## 4. Audit: production platform

| Area | Finding | Risk |
|---|---|---|
| Schema parity | The production database lacks at least the `quizbox_core` schema (wallets, payments, settings, audit helper) and `access_entitlements`. Migrations were applied by hand through the SQL editor; production history is not recorded (C3, C4). | **High.** Any migration can fail or behave differently in production. |
| Database access | The pooler password was rejected on 6 October; the agent tooling cannot reach production (C1, blocked). | **High.** Blocks parity checks, backups and automated verification. |
| Backups | No proven backup-and-restore (C5). | **High** for a system holding learner data. |
| Environments | `.env.local` points at production. Local development and tests can touch real data. | **Medium.** |
| Deploys | Vercel deploys main; a build takes 10–15 minutes. The release branch is the working branch. | Fine. |
| Legacy data | Older curricula and pilot batches are still active alongside the verified ones. | Medium (confusing learner views). |

---

## 5. Audit: interface and experience

**Strengths:** one design system (tokens, cards, chips); a clear role shell; plain-language error messages mapped from server codes; and the recently simplified practice flow.

**Gaps:**
- **Student Home** does not yet follow the design (Continue, Today's goal, mastery by subject).
- **Missing states:** no empty or loading illustrations.
- **Player question types:** the player supports only the existing types; matching, ordering, fill-blank and numeric are missing.
- **Admin pages** are dense tables with raw codes in places. They work for an expert, not for support staff.
- **Branding images:** subject logos and page images are not yet produced. The prompt bank and the fallback tiles are ready.

---

## 6. Audit: mobile readiness

| Item | Finding |
|---|---|
| Responsive CSS | 21 media queries, including touch-pointer and reduced-motion rules. Layouts were never checked systematically at 360–390 px (G5). |
| Installable web app | No web manifest, no service worker, no offline handling. |
| API for a native app | The backend is Supabase: auth plus RPC functions plus row-level security. A native app can use the same functions directly. There is no published, versioned API contract, and some actions go through Next.js API routes that expect browser cookies. |
| Deep links | `/auth/callback` handles email links for the web only. |
| Push notifications | None. Notifications are in-app only. |

**Conclusion:** the backend is already app-ready in principle. The work is a phone-first UI pass, a published API contract, and token-based access for the few server routes.

---

## 7. Audit: security

| Control | Status | Evidence |
|---|---|---|
| Server-side authorisation | Strong | Sensitive actions are SECURITY DEFINER functions with explicit role and capability checks. Rate limits exist for content and attempts. Isolated database tests cover denials. |
| Row-level security | Mostly in place, **needs a full audit** | RLS is enabled table by table and in loops across migrations. A one-time production query should prove every table has it. |
| Over-broad grants | Open | `authenticated` holds TRUNCATE on 92 tables, and there are 45 unneeded `anon` grants (tracker C6). |
| Security headers | **Missing** | No Content-Security-Policy, HSTS, frame-ancestors or referrer policy in `next.config.ts`; no middleware. |
| Passwords | Partial | Weak-password check runs in the browser only (A5). Leaked-password protection is off (recorded in `docs/release-blockers.md`). |
| Dependencies | Open | `npm audit` on production dependencies: 6 findings (1 high, 4 moderate, 1 low), in `next`, `katex`, `source-map-js` and `sprintf-js`. |
| Secrets | Medium risk | Service-role key used only server-side (`lib/supabase/server-admin.ts`, one ops route). Local env file points at production. |
| Monitoring and response | Missing | No error monitoring, no alerting, no incident runbook (G9). |
| Minors' data | Open | Learners include children. Consent rules for under-13s are not designed (G8). Registration under Ghana's Data Protection Act, 2012 (Act 843) should be confirmed with counsel. |
| Backups | Missing | See section 4. |

---

## 8. Owner action sheet (the only things that need you)

Everything else in this plan proceeds without your input. These items are batched so you can clear them in one or two sittings.

| # | Action | Why only you | Unblocks |
|---|---|---|---|
| O1 | Reset the Supabase database password and save the pooler connection string in `PGPASSFILE` on this PC | Credential | Phase 0 (parity, backups, automated checks) |
| O2 | Supabase dashboard: turn on **leaked-password protection** | Dashboard-only switch | Phase 3 |
| O3 | Vercel: turn on **domain auto-renewal** for quizbox.io | Billing | Avoids an outage in October 2027 |
| O4 | Read the sample and approve each question batch (about 10 minutes per 1,000 questions) | Interim review decision you made | Phase 1 |
| O5 | Choose the payment provider (for example Paystack with mobile money) and open the merchant account | Contract | Phase 5 |
| O6 | Set the free allowance number and the plan prices | Commercial decision | Phase 5 |
| O7 | Set reviewer fees in `config/reviewer-policy.json`, or tell me the numbers | Commercial decision | Phase 6 |
| O8 | Decide the under-13 account rule (teacher-managed, with consent) and have privacy and terms text drafted by counsel | Legal | Phase 2 (G8), launch |
| O9 | Keep the 8 generator accounts running (start kits A2–A8) | Accounts are yours | Phase 1 volume |

---

## 9. How I will finish quickly and keep it audited

**Working method:**
- **Vertical slices, not layers.** Each slice is one user journey end to end: database, function, screen, tests and phone check. It ships only when the whole journey passes.
- **Definition of done for every change:**
  - Isolated database tests, including denial tests for every permission.
  - Type-check clean and the full test suite green.
  - A rollback file for every migration.
  - Checked at 390 px and 1440 px.
  - Error states in plain language.
  - Tracker row updated with evidence.
  - Deployed only when you say "deploy".
- **Production truth first.** After Phase 0, every migration is checked against a production fingerprint before you apply it. No more surprises like `quizbox_core`.
- **One gate per phase.** Each gate has a written evidence list, so "done" means verified.
- **Three parallel lanes:**
  - **Lane A (me):** code, tests, migrations, documents.
  - **Lane B (generator agents):** questions, checked by the bank tool.
  - **Lane C (you):** only the owner action sheet.
- **Internal audit at each gate:** a separate review pass over the changed areas (correctness, security, UX copy). Findings are fixed before the gate closes.

---

## 10. The critical path, step by step

### Phase 0: Production truth (needs O1)
1. **Fingerprint the schema:** read the production schema (schemas, tables, functions, triggers, grants, RLS state) into a fingerprint file.
2. **Compare and plan:** compare it with the repository chain and write a reconciliation plan. List each missing object (for example `quizbox_core`) and decide whether to apply it, rewrite around it, or retire it.
3. **Apply or rewrite:** do the reconciliation in small, reversible migrations, and record them in production history (C3).
4. **Prove backups:** back up, then restore into an isolated database, and record the evidence (C5).
5. **Separate environments:** move local development off production (a Preview or local database), so tests never touch real data.

**Gate 0 evidence:** fingerprint equal to the repository, a restore proven, local environment separated.

### Phase 1: Questions reach learners (runs alongside Phase 0; needs O4, O9)
1. **First approval:** approve the first B5 English batch and confirm a B5 learner sees the topics.
2. **Delta files:** add a delta output to the bank tool so each load contains only new questions.
3. **Progress dashboard:** a generation dashboard across all 8 accounts, built from their returned files.
4. **Clean-up:** retire the duplicate legacy curricula after checking what is attached to them.
5. **Topic names:** fallback so a learner never sees a code.
6. **Weekly cadence:** generate, check, load, sample, approve.
7. **Priority:** B4–B9 core subjects first, then SHS.

**Gate 1 evidence:** at least one full grade in at least two subjects live, and a learner run recorded.

### Phase 2: Core journeys complete
1. **Learner:** sign-up through onboarding, practise, results and progress (A10, G1). Student Home redesign.
2. **Teacher:** classes, assignments, gradebook and remedial practice. Confirm a teacher can start a practice attempt.
3. **School admin:** classes, staff, learners and performance.
4. **Admin and support console:** account lookup, suspension, audit trail, failed-operation monitor, a ticket inbox fed by the contact form, plain-language admin tables, and support-only views via `sme_support`.
5. **Notifications:** assignment due, result ready, batch approved.
6. **Live acceptance suite green on Preview (G2),** with the suite extended to every journey above.

**Gate 2 evidence:** every journey has an automated end-to-end test and a phone-width screenshot.

### Phase 3: Security hardening (starts now, closes with Phase 2; needs O2)
1. **Security headers:** CSP, HSTS, frame-ancestors, referrer and permissions policies, in report-only mode first, then enforced.
2. **Grant hardening (C6):** remove TRUNCATE and unneeded anon grants, with a rollback.
3. **RLS audit:** a production query that lists any table without RLS or with a permissive policy, then a fix for each.
4. **Server-side password policy (A5)** and leaked-password protection (O2).
5. **Dependencies:** clear the 6 `npm audit` findings, and add a weekly dependency check.
6. **Monitoring:** error monitoring, alerts on failed operations and sign-in spikes, and an incident runbook (G9).
7. **Abuse limits:** rate limits reviewed for sign-up, sign-in, practice start and loading.
8. **Data protection:** a minors' data review (retention, consent, export, deletion), with your legal input (O8).
9. **External check:** an OWASP ASVS Level 2 self-assessment, then an external penetration test before the paid launch.

**Gate 3 evidence:** headers enforced, C6 and the RLS audit clean, 0 high dependency findings, an alert fired in a drill, and the runbook written.

### Phase 4: Mobile and app-ready
1. **Phone-first pass:** every screen at 360, 390 and 768 px, with touch targets of at least 44 px, readable tables (stacked cards on phones) and the attempt player optimised for one-handed use.
2. **Installable web app:** a manifest, icons and a service worker for the app shell, plus offline notices. No offline answering until it is designed safely.
3. **API contract for a native app:**
   - A versioned list of the RPC functions the app may call. The public allow-list mechanism already exists.
   - Token-based access for the few Next.js API routes.
   - Deep links for sign-in.
4. **Native shell decision:** wrap the web app (Capacitor) for speed, or build with Expo or React Native on the same backend. Recommendation: PWA first, then Capacitor, and a native rebuild only if usage demands it.
5. **Push notifications** through the same notification records.

**Gate 4 evidence:** a Lighthouse mobile score recorded, an install tested on Android, and the API contract published.

### Phase 5: Revenue (needs O5, O6)
1. **Rebuild the free-allowance gate** on its own small settings table, so it no longer depends on `quizbox_core`.
2. **Payment adapter** for the chosen provider, built on the existing provider-neutral contract (`lib/core/payments.ts`), with webhooks and reconciliation.
3. **Subscription records:** subscription entitlement, receipts, renewal and cancellation. Server enforcement for practice-set attempts.

**Gate 5 evidence:** a test payment through to entitlement and back (refund), plus reconciliation.

### Phase 6: Reviewer workforce (needs O7)
1. **Reviewer application:** teacher and SME application, vetting, and domain grant by support staff.
2. **Review routing:** loaded questions routed to the SME pool (L6). Owner approvals are gradually replaced, and owner-approved batches are re-reviewed by revoking and re-queueing.
3. **Pay:** earnings, QA sampling and payouts (R5–R8).
4. **Labels:** truthful provenance labels for learners (L7).

**Gate 6 evidence:** SME coverage above 0 for every live subject; one payout batch run end to end.

### Phase 7: Evolution
- **Challenges:** follows the Extension Blueprint in order: roles, then the campaign domain on the competition engine, then a Book Challenge pilot, then tenancy. The Phase 0 documents are already in `docs/blueprint/`.
- **New markets:** use the market playbook.

---

## 11. Dependencies at a glance

```
O1 password ─► Phase 0 ─► (migrations safe) ─► Phase 2 ─► Phase 4
                  │                               │
                  └──────► Phase 5 (gate rewrite) ◄┘ ◄── O5, O6
O4, O9 ─► Phase 1 (content) ──────────────────────► Gate 1 pilot
Phase 3 security ── runs alongside 0–2, closes before any paid launch ◄── O2, O8
Phase 1 + Phase 2 ─► Phase 6 reviewers ◄── O7
Gates 1–6 ─► Phase 7 evolution
```

**The single longest chain** is O1, then Phase 0, then Phase 2, then Phase 4. Clearing O1 (the database password) is the most valuable thing you can do this week.

---

## 12. Risks and how they are handled

| Risk | Handling |
|---|---|
| Production drift breaks a migration | Phase 0 fingerprint before every migration; small reversible steps |
| Question volume too slow | 8 accounts in parallel; agent kits; prioritise grades; weekly measurement |
| Weak questions reach learners before reviewers exist | Owner sample per batch; honest OWNER_BATCH label; one-call revoke; bank checker gates |
| Security incident | Phase 3 controls; monitoring; runbook; external test before paid launch |
| Children's data | Consent design (G8), data protection review, legal text by counsel |
| Single owner bottleneck | Owner action sheet batched; support staff capability for day-to-day management |

---

## 13. What happens next, without further input
1. **Owner-batch rerun:** confirm on production once you rerun the preview, then approve batch one.
2. **Delta files:** add the delta-file output to the bank tool.
3. **Free-allowance gate:** rewrite it on its own settings table (Phase 5, step 1). It is small and removes a dependency on the missing schema.
4. **Security headers:** add them in report-only mode (Phase 3, step 1).
5. **Dependencies:** clear the dependency findings (Phase 3, step 5).
6. **Grant hardening:** write the C6 migration with its rollback, ready for when production access returns.
7. **Topic names:** add the fallback.
8. **Phone-width audit:** check every learner and teacher screen and fix layouts.
9. **Phase 0 tooling:** prepare the fingerprint scripts so Phase 0 runs the day O1 is cleared.

Each item is committed on the release branch with tests. Since 18 October the owner has authorised automatic deploys: each delivery goes live as soon as its tests and the build pass.

---

## 14. Delivery log

Status per item of section 13. **Live** means the code is deployed. A database migration is in effect only after you apply it; see `docs/release/APPLY_2026-10-18.md`.

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Owner batch approval works on production | **Delivered (live)**, migration step 1 to apply | New screen **Approve Batches** (`/admin/question-batches`): read the sample, tick 20, approve, or revoke. No SQL needed. The functions no longer use the missing `quizbox_core` schema; 6 tests run without it. |
| 2 | Delta load files | **Delivered** | `bank.py export-new` writes `Questions Bank/_load/<Grade>_<Subject>_new_<n>.csv` with only questions never loaded, in whole topics. `mark-loaded` records past loads. The B5 English 1,000 already loaded are recorded; `B5_English-Language_new_100.csv` is ready. |
| 3 | Free-allowance gate without the missing schema | **Delivered (live)**, migration step 2 to apply | `20261018100000_access_gate_standalone.sql`: own settings and subscription tables, manual grants that stack, and revoke. New screen **Access & Subscriptions** (`/admin/access`). 6 tests, built without `quizbox_core`. |
| 4 | Security headers | **Delivered (live)** | HSTS, X-Frame-Options DENY, nosniff, referrer and permissions policies, COOP and no `X-Powered-By`, all enforced. Content-Security-Policy runs in report-only mode first (`lib/security/headers.ts`, one line to enforce). 2 tests. |
| 5 | Dependency findings | **Delivered (live)** | `npm audit --omit=dev`: 6 findings, now **0**. Next.js 15.5.28; KaTeX 0.19.0; mammoth's unused CLI parser pinned to a safe version. |
| 6 | Grant hardening (C6, part 1) | **Delivered**, migration step 4 to apply | `20261018120000`: TRUNCATE, REFERENCES and TRIGGER removed from client roles on every app table, and for future tables; read and write untouched. 3 tests. Part 2 (narrowing anon grants) waits for the production grant list. |
| 7 | Readable topic names | **Delivered**, migration step 3 to apply | `20261018110000`: a topic whose title is a code or placeholder shows its first indicator's wording; code-like strand names are hidden. 4 tests, including the B9 case you reported. |
| 8 | Phone-width audit | **Delivered in part (live)** | Live check at 390 px of all 10 public pages (home, login, register, contact, three join pages, privacy, terms, forgot password): **no sideways scrolling** on any of them. Touch screens now get 44 px chips and table buttons. **Installable app:** web manifest, 192/512 icons, theme colour and home-screen support (Phase 4 step 2, no service worker yet). The signed-in screens follow the same CSS (tables become cards under 768 px), but they were not rendered: that needs a test account on a Preview database (Phase 0). |
| 9 | Phase 0 tooling | **Delivered** | `scripts/release/expected_objects.py` produces `docs/release/engine/17_production_missing_objects.sql`, a read-only query listing which of the 404 objects the repository creates are missing in production. Validated on an empty database. |

**Totals after this delivery:** 944 tests pass, type-check clean, production build passes.

**Verified on production after deploy:** every response now carries HSTS, X-Frame-Options DENY, nosniff, referrer and permissions policies, and the report-only Content-Security-Policy. Ten public pages produced no policy violations, so the policy can be enforced after a short observation period.

### Delivery 3 (18 October)
| Item | Status | Evidence |
|---|---|---|
| Teacher practice (audit finding: "starting an attempt as a teacher not verified") | **Delivered (live)**, apply pack step 6 | Confirmed in the repository that attempts require a learner profile, so a teacher's set could not open. Teachers and admins now open their set at `/practise/preview/<id>`: every question, reveal or hide answers and explanations, print. Read-only; records nothing. 2 tests (own set only; learners and other staff refused). |
| Mobile API contract (Phase 4 step 3) | **Delivered** | `docs/api/MOBILE_API_CONTRACT.md`, generated from the code by `scripts/release/api_contract.py`: 129 database functions by role, 39 table operations under row-level security, 8 server routes, the public allow-list, and a versioning rule (never change a function in place; add `_v2`). |

| Generation progress across 8 accounts (Phase 1 step 3) | **Delivered** | `python scripts/question-bank/bank.py status` prints and saves `_work/reports/STATUS.txt`: accepted against target per account and per level, units in progress, packs done. Today: 1,100 of 285,600 (0.39%); only account A1 has started. |

**Totals:** 946 tests pass, production build passes.

### Delivery 4 (19 October)
| Item | Status | Evidence |
|---|---|---|
| Production truth (Phase 0 steps 1 to 3) | **Done** | The missing-objects check found 41 objects missing (three migrations never applied: core platform, school performance, auth-failure hardening). All three were dry-run, then applied. Re-check: only the obsolete helper `merge_quizbox_question_import` remains. |
| Production truth, deeper check | **Done** | Triggers, policies, row-level security and grants checked. The Data API exposes only `public`; classes and class_memberships have full policies (the four "missing" names were renamed); 13 internal tables had RLS off but were unreachable (no grants, no schema access, no client-callable function reads them). |
| Migration history (tracker C3) | **Done** | The 26 hand-applied migrations are recorded. |
| RLS on internal schemas (C6 part 2) | **Delivered**, apply pack 19 Oct step 1 | `20261018140000`: switches RLS on for internal tables and logs exactly which, so the rollback undoes only those. 3 tests. |
| Public enquiry intake and staff inbox (Phase 2 support console) | **Delivered (live)**, apply pack 19 Oct step 2 | Owner-approved the standing proposal. The five public forms submit through a server route (same-origin, 8 KB limit, hidden-field and timing checks, strict validation, durable rate limits, hashed address only); staff triage at `/admin/inbox` (super admin and support staff); retention 24 months closed, 90 days spam. One design flaw in the proposal fixed: its write function sat in a schema the Data API does not serve, so a public wrapper callable by the server role only was added (no new anonymous function). 27 tests. |

**Decisions taken as owner (for your review):** approve the single-table contract; closed enquiries kept 24 months and spam 90 days; super admin plus support staff may review, only the owner may purge; no CAPTCHA for now (honeypot, timing and database limits instead); address hash keyed by the existing service-role key, so no new secret. **Privacy notice:** still a placeholder; the retention periods above must be stated in it once counsel drafts the text.

**Totals:** 976 tests pass, production build passes.

### Delivery 5 (19 October)
| Item | Status | Evidence |
|---|---|---|
| Public intake applied in production | **Verified** | Migration applied; the two functions exist. The live route was exercised without storing anything: a too-fast submission is dropped silently (202), a bad email returns 400 with a plain message, a foreign origin returns 403. Security headers confirmed on `/contact`. |
| Error monitoring (Phase 3 step 6, tracker G9) | **Delivered (live)**, migration `20261019100000_client_error_monitoring` to apply | Crashes and unhandled errors in any browser are reported (path only, ids and emails stripped, repeats counted, 600 an hour cap) and grouped on **Admin, Support** with crash counts and a red alert at 20 an hour. Friendly error pages replace the blank crash screen. In-house on purpose: no third party sees user data. 7 tests. |
| Incident runbook (G9) | **Delivered** | `docs/ops/INCIDENT_RUNBOOK.md`: site down, crash spike, sign-in failures, wrong question, suspected breach (with the Act 843 reporting step flagged for counsel), payments, bad deploy and rollback, plus `INCIDENT_LOG.md`. Contacts table to fill in. |

**Totals:** 983 tests pass, production build passes.
