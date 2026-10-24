# Functional and business-process QA report (Phases 3, 5 and 6)

Honest scope: nothing signed-in was exercised in a browser, because no disposable test accounts or Preview database were available to the auditor. What was executed: the repository's automated suite (database logic runs in PGlite, an isolated PostgreSQL), static tracing of UI to API to database, and read-only browsing of the public site. Statuses use PASS, FAIL, BLOCKED, NOT RUN.

## Executed results

| Check | Result | Evidence |
|---|---|---|
| Type check (`tsc --noEmit`) | PASS, 0 errors | evidence/baseline-typecheck.log |
| Lint | PASS, 0 errors, 1 warning (public/sw.js) | evidence/baseline-lint.log |
| Unit and database tests | PASS: 1,186 passed, 0 failed, 119 skipped (the 6 live acceptance suites) | evidence/baseline-vitest.json |
| Production build | PASS, 0 warnings (run on the pre-audit tree) | build log from the delivery before this audit |
| Added regression tests | PASS: `components/appshell-nav.test.ts` (fails without the fix), `lib/pricing/server.test.ts` | this branch |
| Public home, pricing, challenges at 1366 px and pricing at 390 px | Rendered; no horizontal overflow on pricing (mobile); all buttons and links have names; all images have alt text | screenshots in docs/user-guides/screenshots |

## Defects found by running or tracing

* **QB-AUD-001 (P1)**: the sidebar "Challenges" link for students (and the new "Open to join" link for teachers) is not in the route allow-list, so the deployed build bounces users home. Fixed on this branch with a failing-then-passing test.
* **QB-AUD-002 (P1)**: the live pricing page shows four placeholder cards ("Tell me when it opens") instead of the configured Coin ladder, and the public challenge list is empty. The code swallowed the cause; logging added. The home page figures (anonymous key) load correctly while both service-role pages fail, which points at the server key rather than the database. Root cause still needs the owner to check the production server key and function logs.
* The earlier user-reported symptom "I clicked Challenges and was asked to sign in" was the public marketing page `/challenges`, which cannot know about a session. Addressed by the in-app `/open` page and a header that shows "Open my workspace" when a session exists (the header change is not covered by an automated browser test: NOT RUN).

## Feature trace (UI to API to database), reviewed by reading

| Journey | Trace | Status |
|---|---|---|
| Learner buys Coins/plan | Subscribe card -> `POST /api/payments/checkout` -> `qb_payment_intent_create` -> Paystack -> webhook -> `qb_fulfil_subscription_payment` | Code PASS; payment itself NOT RUN (no test keys session) |
| Student creates a quiz | Studio -> `challenge_create/set_questions/publish` with DB triggers forcing curriculum-only, link-only, no prizes/logo/material | DB tests PASS (`student-academic-limits-sql.test.ts`); UI NOT RUN |
| Competition rounds | `challenge_stages`, `qb_challenge_cleared/stage_rank` | DB tests PASS (`competitions-sql.test.ts`); UI NOT RUN |
| Drafts 24 h / 2 h warning | `activity_drafts`, sweep route, Resend email | DB and sweep tests PASS; email delivery NOT RUN |
| Teacher manages young learners | `/api/teacher/learners*` with budget limits | Route reviewed; `managed.test.ts` PASS; UI NOT RUN |
| Assignments, gradebook, practice, scoring | Existing DB suites for learning loop | PASS (automated); UI NOT RUN |
| Admin loads and approves questions | question-loading libs and batch approval RPCs | Existing tests PASS; UI NOT RUN |

## Cosmetic-control check

No control was found that looks functional with no backend. One deliberate gap: payment bundles beyond subscriptions (seat purchase for challenges) are not built; the pricing page lists seat rows as products, so a visitor could believe they can be bought. Verify the live behaviour (QB-AUD-002 blocks that view).

## Missing categories (NOT RUN)

Invalid-input and boundary testing in the browser, duplicate-submission, session-expiry, cross-role visibility with two real accounts, interrupted operations, keyboard-only walkthroughs, export/report downloads. These are written as scripts in `docs/beta-testing/test-scenarios.md` for interns to run on Preview.
