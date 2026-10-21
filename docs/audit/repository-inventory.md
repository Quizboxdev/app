# Repository inventory (Phase 0)

Audit date 2026-10-21. Auditor: Claude Code in an independent-review role. This is the same tool family that built much of the code, so the findings were checked against executed output wherever possible and are labelled where they rest on reading alone.

## Identity

| Item | Value |
|---|---|
| Workspace root | `C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment` |
| Remote | `https://github.com/Quizboxdev/app.git` |
| Starting branch / HEAD | `release/public-homepage-hardening` / `432dded` (local clean commit; remote `origin/main` and the release branch hold `05b437f`, see QB-AUD-003) |
| Audit branch | `audit/2026-10-21-independent-review` |
| Other branches | `main`, `dev`, `handover/remaining-work`, `backup/pre-oct7-repair-amend` |
| Pre-existing uncommitted work | Modified: `reports/authenticated-acceptance.json`, `scripts/question-bank/bank.py` (+ pycache). Untracked: `Questions Bank/*`, `Images/`, `scratch/`. Not touched by this audit. |
| Deployed identity | `www.quizbox.io` serves the build of `05b437f` (route `/open` exists live). `quizbox.io` redirects (308) to `www`. |
| AGENTS.md | Not present. README.md, README_BATCH2.md, ACCEPTANCE_TEST_CHECKLIST.md present. |

## Stack

Next.js 15 (App Router) + React 19 + TypeScript; Supabase (Postgres, Auth, Storage, RLS, pg_cron); Vercel hosting (`vercel.json` has one cron: managed-erasure; other schedules run from pg_cron calling `/api/cron/*`); Resend (email), Paystack (payments), web-push; vitest + PGlite for database tests; npm lockfile. No Docker files. **No CI workflows** (QB-AUD-005).

## Size

| Item | Count |
|---|---|
| SQL migrations | 106 (rollbacks: 54 files in `supabase/rollback`) |
| Distinct SQL functions defined | 276 |
| Public tables created | 98 (all have RLS statements, see security-review.md) |
| App pages (`page.tsx`) | 90 |
| API route handlers | 21 |
| Components | 58 files |
| Test files | 133 (6 are `*.live.test.ts` acceptance suites that need a live environment) |

## Environment variables (names only; values never read)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `..._PUBLISHABLE_KEY`), `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`, `CRON_SECRET`, `QB_OPS_SECRET`, `QUIZBOX_GENERATION_API_KEY`, `QUIZBOX_GENERATION_ENDPOINT`, `QB_SUPABASE_MANAGEMENT_TOKEN`, `QB_ENVIRONMENT`, `QB_ACCEPTANCE_*`, Resend/EMAIL_FROM settings. `.env`, `.env.*` are git-ignored; only `.env.example` files are tracked. A pattern scan of tracked source found no keys, tokens or connection strings (one test constant `sk_test_secret` is a fake).

## Feature inventory (status = what the code shows, not what was exercised)

| Area | Feature | Status | Notes |
|---|---|---|---|
| Public | Home, Pricing, Challenges, Competitions, Contact, Privacy, Terms, Join pages | IMPLEMENTED | Pricing shows placeholders live (QB-AUD-002) |
| Auth | Sign-up/in, onboarding, password reset, callback, suspended-account handling | IMPLEMENTED | Reset email sender configured via Resend (owner confirmed) |
| Student | Home, Practise, Assignments (classroom), Compete, Challenges, Create and share, Progress, Assessments, Marketplace, Notifications, Unfinished work (drafts), Account | IMPLEMENTED | Student-created quizzes limited to curriculum content by DB triggers |
| Teacher | Dashboard, Classes, Young (managed) learners, Assignments, Gradebook, Question Banks, Practise, Challenges/Competitions, Marketplace | IMPLEMENTED | |
| School | Overview, Classes, Teachers, Learners, Performance | IMPLEMENTED | |
| Sponsor | Dashboard, Workspace (flag), Challenges, Competitions | IMPLEMENTED / DISABLED flag for workspace | `sponsorEngineEnabled` |
| Admin/Owner | Dashboard, Content ops, Curriculum structure/sources, Load Questions, Approve Batches, Quality, Marketplace governance, Challenge reports, Competition ops, Operations, Support, Access and Subscriptions, Prices, Young learners | IMPLEMENTED | |
| SME/Reviewer | Reviews, policy, applications, payouts, compensation | IMPLEMENTED (capability-gated) | |
| Seller | Marketplace seller area | IMPLEMENTED | |
| Commercial | Price list, Coin ladder, Paystack checkout + webhook, subscription fulfilment | IMPLEMENTED | End-to-end test with real/test Paystack NOT RUN |
| Challenges | Challenges and Competitions (rounds), sharing, audiences, reading material, templates, carousel | IMPLEMENTED | Seat caps / seat purchase: NOT FOUND (planned Phase 2) |
| Drafts | 24 h holder, 2 h warning, email | IMPLEMENTED | |
| Ops | Client-error intake, analytics refresh, cron jobs | IMPLEMENTED | |
| Mobile | `docs/api/MOBILE_API_CONTRACT.md` contract | DOCUMENTED (no mobile client in repo) | |

## Limitations recorded

1. No access to the production or Preview Supabase projects (the connector sees two unrelated inactive projects). Database claims rest on migrations plus PGlite tests.
2. Vercel runtime logs returned 403.
3. No test accounts were available, so signed-in browser journeys were not executed.
4. No isolated load environment, so performance was not measured.
