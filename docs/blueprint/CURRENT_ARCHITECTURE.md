# Current architecture

> **Historic (2026-10-14).** Superseded for the overall picture by `docs/DILIGENCE_OVERVIEW.md` (2026-10-25). Since this note: payments (Paystack), the sign-in guard and middleware, the marketplace, admin exports, challenges and competitions, the Help and support centre and the policy system were added. Kept for its table of unknowns at that date.

Confirmed from the repository on 2026-10-14. **UNKNOWN** marks anything not found in code, schema or config.

## Stack
- Next.js 15 (App Router), React 19, TypeScript 5.8; Supabase (`@supabase/supabase-js` 2.x) for auth, Postgres and storage; Vercel hosting (deploys `main`, 10 to 15 minute builds).
- Tests: Vitest 4 with PGlite for isolated-Postgres SQL tests; 923 pass, some live-acceptance files are skipped by design.
- No `middleware.ts`. Access control is route-level in `components/AppShell.tsx` plus RLS and SECURITY DEFINER RPCs. `instrumentation.ts` exists.

## Auth and identity
- Supabase Auth. `public.profiles` holds `role` (enum `qb_role`: student, teacher, admin, sponsor) and `default_market_id`. `student_profiles` carries grade. `user_capabilities` with `quizbox_sme.has_capability` gives composable capabilities (reviewers, support).
- `app/auth/callback` handles email links. **UNKNOWN:** a deep-link "return to campaign after login" contract.

## Data (103 tables in supabase/migrations)
- `public`: curricula, curriculum_nodes, questions, assessments, attempts, classes, institutions, tenant_memberships, wallets, payment_intents, payment_events, access_entitlements, notifications, audit_logs, learning_events.
- `quizbox_core`: settings, wallet and coin functions. `quizbox_market`: markets and readiness. `quizbox_sources`: source registry. `quizbox_factory`: question-generation campaigns. `quizbox_competition`: sponsor competition engine. `quizbox_sme`: reviewers, pool, earnings. `quizbox_topic`: topic registry. `quizbox_ops`, `quizbox_private`.

## Storage
Private buckets only: `question-media` (images, 5 MB), `competition-sources` (10 MB, PDF and documents), `curriculum-sources` (50 MB, PDF). **UNKNOWN:** signed-URL read policy for uploaded books; malware scanning.

## Question and quiz flow
Verified files -> staging -> admin loader (`qb_curriculum_nodes_import`, question loading) -> `questions` -> SME review pool -> published. Delivery: `qb_start_attempt` and `qb_start_quick_practice` create an assessment with snapshot rows; `qb_complete_attempt` scores on the server.

## Competition
`quizbox_competition`: sponsor_organizations, organization_members, documents, chunks, generation_jobs, drafts, candidates, bank_items, invitations, registrations, participations, leaderboard, snapshots, official_results, review_events. Sponsor self-service is OFF in production by decision; admins set competitions up. API generation is deferred; questions come from files.

## Payments and rewards
`payment_intents`, `payment_events`, `wallets`, the coin ledger and `access_entitlements`. The provider adapter contract is in `lib/core/payments.ts`. **No provider is connected; online payment is disabled.**

## Public web
`app/(public)`: home, contact, join/{sponsor,sme,school,country}, privacy, terms. Home sections are switchable in `config/public-visibility.json`.

## Hosting
Production project `fmgccmqxfjppqydkhaiu`, www.quizbox.io. The production database is not reachable from the agent tooling; the owner applies migrations in the SQL editor. **UNKNOWN:** Preview database parity with production (tracker C4).
