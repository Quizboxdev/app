# Core module implementation report

Date: 2026-10-05. The repository is `Codes/QuizBox_Batch1_Student_Teacher_Assessment` (its own git repo).
Provenance: `quizbox.ransford.eddy.mensah`, recorded in `docs/IP_PROVENANCE.md`.

## 1. Architecture found

- **Stack:** Next.js 15 (App Router) and React 19 with TypeScript. Supabase Postgres, Auth and Storage. Vitest with in-memory PostgreSQL (PGlite) for database tests.
- **API style:** there is no REST layer. Browser clients call guarded `public.qb_*` RPCs (`lib/api/*.ts`). RLS fails closed. Service-role code is server-only (`lib/supabase/server-admin.ts`). There are only two reviewed anon RPCs (`lib/operations/public-rpc-allowlist.ts`).
- **Auth and roles:** Supabase Auth with `profiles.role` (student, teacher, admin, sponsor, owner), `user_capabilities`, `institution_memberships` and country-first onboarding. This is already a partial membership model, so it was extended rather than replaced.
- **Production:** `fmgccmqxfjppqydkhaiu` has the first 24 migrations (to `20261005100000`). The `20261006*` migrations are not authorized yet. **Nothing in this pass was applied to any database.**

## 2. Audit matrix

| Module | Status | Reusable files | Change made or required |
| --- | --- | --- | --- |
| Auth / identity | EXISTS | `lib/auth.ts`, `profiles` | None. |
| Multi-role / RBAC | PARTIAL | `user_capabilities`, `quizbox_sme.has_capability`, `institution_memberships` | Widened the capability vocabulary. Added `quizbox_core.held_roles`, `qb_my_roles`, `qb_switch_workspace` and `user_workspace_context`. |
| Organisations / workspaces | PARTIAL | `institutions`, `tenants`, `quizbox_competition.sponsor_organizations` | Workspace context added. The three org tables are not unified (deferred). |
| Curriculum core | EXISTS | `countries`, `markets`, `curricula`, `curriculum_nodes` (canonical identity migrations) | None. Proficiency bands moved to configuration. |
| Question bank | EXISTS (legacy A–D columns plus the rich-content and versions model) | `questions`, `question_versions`, content factory, `lib/content/*` | None. Extending to all response types is deferred (see 9). |
| Content workflow / SME review | EXISTS | `sme_review_*`, `question_factory_governance`, `quizbox_factory` | None. AI-generated content already requires review. |
| Student learning (Learn/Practise/Assess/Compete) | PARTIAL | `learning_events`, `mastery_records`, the practice RPCs | `learning_unit`, `learning_activity` and `recommendation` are deferred. |
| Attempts / player | EXISTS (tied to assignments) | `attempts`, `responses`, `lib/api/assessment.ts` | Added `sync_status` and `client_updated_at`. |
| Assessments / assignments / classes | EXISTS | `assessments`, `assignments`, `classes`, `class_memberships`, `gradebook` | None. |
| Results / mastery / proficiency | EXISTS (hard-coded) | `lib/learning/{proficiency,mastery}.ts` | Bands are now configuration. Added a mastery strategy interface and the QuizBox state mapping. |
| Gamification | PARTIAL | `xp_transactions`, `components/achievements` | Added QPoints ledger, badges, streaks and `reward_rules`. |
| Wallet / coins / ledger | MISSING | none | New wallet, immutable ledger and `access_entitlements` (the marketplace `entitlements` table is untouched). |
| Payment core | MISSING | none | New payment intents, events, verified settlement, reversal and reconciliation. |
| Relationships (guardian/sponsor) | MISSING | none | New `account_relationships` and RPCs. |
| Notifications | EXISTS | `notifications`, `quizbox_ops.notify`, `NotificationBell` | Added `category`. The existing hosted `notification_deliveries` table is reused unchanged; this migration does not create, alter or drop it. |
| Safety / consent | MISSING | none | New `learner_consent`, `qb_feature_allowed` and the blocked-feature setting. |
| Audit | EXISTS | `audit_logs` | Reused via `quizbox_core.audit`. |
| Admin | EXISTS | `app/(app)/admin/*`, `qb_admin_ops` | New admin RPCs added: settings, wallet adjust, payment reconcile. No UI. |
| Config / feature flags | MISSING | env only | New `platform_settings`. |
| Google Sheets import | EXISTS | `scripts/import-content.ts`, `lib/content/sources` | Untouched. |
| Tests | EXISTS | 43 suites | Added 2 suites. |
| Deployment / env | EXISTS | `.env.example`, `docs/*runbook*` | None. |

## 3. Reused, extended and created

- **Extended:** `user_capabilities` (constraint widened), `notifications` (category), `attempts` and `responses` (sync columns), `lib/learning/proficiency.ts` (bands as a parameter with an identical default), `lib/api/platform.ts` (`call` exported).
- **Created:** migration `20261007100000_core_platform_foundation` plus its rollback, `lib/core/{roles,config,payments,useWorkspace}.ts`, `lib/api/core.ts` and `lib/provenance.ts`.

## 4. Database changes (migration `20261007100000`, additive only, not applied)

- **New tables:** `platform_settings`, `account_relationships`, `user_workspace_context`, `wallets`, `coin_transactions` (immutable), `access_entitlements`, `payment_intents`, `payment_events`, `qpoint_transactions` (immutable) with the `qpoint_balances` view, `badge_definitions`, `user_badges`, `user_streaks`, `learner_consent`.
- **Collision avoidance:** hosted databases already have `public.entitlements` (marketplace) and `public.notification_deliveries`. Both are left completely untouched and are never dropped by the rollback. Core grants live in `public.access_entitlements`.
- **Seeded safe defaults:** `buy_coins_enabled=false`, `student_self_pay=false`, `sponsor_consent_required=true`, no payment providers and no coin pricing. No payment can be created until the owner configures providers and pricing.
- **Seeded proficiency bands** (Ghana CCP, global default) and the consent-blocked feature list.
- **Security:** RLS on every table and no client write grants. Settlement and QPoint award are executable by `service_role` only. All other new RPCs are revoked from `anon`.

## 5. APIs added

Client RPCs: `qb_my_roles`, `qb_switch_workspace`, `qb_relationship_request`, `qb_relationship_decide`, `qb_relationship_allows`, `qb_payment_intent_create`, `qb_feature_allowed`, `qb_setting_set`, `qb_wallet_adjust`, `qb_payment_reconcile`, `qb_consent_set`.

Server-only RPCs: `qb_payment_apply_event`, `qb_qpoints_award`.

## 6. Frontend integration points

- **Roles and guards:** `lib/core/roles.ts` (role list, `canAccess`, `homeRouteForWorkspace`).
- **Workspace hook:** `lib/core/useWorkspace.ts` (roles, flags, switching).
- **API client:** `lib/api/core.ts` (relationships, wallet, intents, flags, proficiency bands).
- **Config:** `lib/core/config.ts` (typed flags, bands, mastery strategy).
- **Payments:** `lib/core/payments.ts` (provider interface and webhook handler).

Existing UI was not changed.

## 7. Deviations from the brief

- **Roles stay as `profiles.role` plus capabilities plus institution and relationship memberships.** They are merged into one list at read time by `held_roles`. Rebuilding auth was not justified, and the brief says to preserve it.
- **Not rebuilt: curriculum, question bank, attempts, assessments, classes, assignments.** Each already exists and works. Building them again would create the parallel systems the brief forbids. Gaps are listed in section 9.
- **Three separate ledgers:** XP stays in `xp_transactions`. QPoints are their own ledger. Coins are in the wallet ledger. The three are never merged.

## 8. Tests

- `npx vitest run` (full suite): **43 files passed, 4 skipped. 565 tests passed, 95 skipped.** The skipped files are the `*.live.test.ts` suites that need a live database.
- `npx tsc --noEmit`: clean.
- `eslint` on the new and changed files: clean.
- New tests cover:
  - `lib/core/core-platform.test.ts` (13 tests, real SQL on in-memory PostgreSQL):
    - role and workspace switching;
    - relationship consent and permission boundaries;
    - payer vs beneficiary;
    - idempotent intent creation and duplicate-event prevention;
    - one provider reference per intent;
    - wallet credit, reversal and the no-negative-balance rule;
    - ledger immutability;
    - grant boundaries and the Coin/QPoint split;
    - consent-driven feature blocking.
  - `lib/core/core-helpers.test.ts`: role guards, flag defaults, proficiency boundaries, the mastery adapter, the webhook boundary and the provenance marker.
- **Failures:** none remaining.
- **Not covered by new tests:**
  - Assessment submission and question approval already have coverage in the existing suites: `assessment-adapter`, `content-review`, `foundation` and `market-enforcement`. No new logic touched them.
  - The migration has been run only on PGlite with stubbed upstream tables. It has not run against a real Supabase branch.

## 9. Technical debt and deferred work

- **Migration rehearsal:** apply `20261007100000` on a Supabase branch first. It needs the owner's authorization, like `20261006*`. Order it after `20261006120000`.
- **Grant sweep:** the migration revokes execute on its own functions explicitly. The existing global grant sweep in `20261002170000` grants execute on every `security definer` function in `public` to `authenticated` when it runs. It does not run again here, so the new service-only functions stay service-only. Re-run `npm run release:verify-security` after applying.
- **No payment provider adapter yet.** Only the interface and the webhook handler exist. No webhook route was added, and there are no PSP credentials.
- **Coin spend path:** `qb_coin_spend` is built (service-role only, see the API notes). No purchase flow calls it yet, and paid challenges are off by default.
- **Refund initiation at the PSP** is out of band. Refunds and reversals reach the ledger only through verified events.
- **Streak and badge awarding logic:** the tables exist, but there are no awarding RPCs.
- **Not built:** `learning_unit`, `learning_activity`, `recommendation`; a unified organisation table across `institutions`, `tenants` and sponsor organisations; and the full question response schema (matching, ordering, numeric and others).
- **Guardian progress visibility:** `can_view_progress` is stored and answerable via `qb_relationship_allows`, but the existing progress RPCs do not consult it yet. Wire it before exposing guardian screens.
- **Role-gated UI:** `useWorkspace` is not wired into `AppShell`. This is deliberate, to avoid disturbing the current UI.

## 10. Provenance

See `docs/IP_PROVENANCE.md`. Marker: `lib/provenance.ts` plus header comments in the migration and its rollback.

## Validation and Integration Pass

Date: 2026-10-05. **Status: local validation complete. Real Supabase branch validation is BLOCKED. Not committed.**

### Supabase branch used: none
- The Supabase connection available in this session lists two projects, `vmdywtzatnyybadhkinf` ("Quizbox") and `rvppkkkuequhxpdrfaik`. Neither is the QuizBox production, the data-cloned preview branch `fngdtxayfoiffbcbmcum`, or the restore project. I did not touch them, because they are not confirmed disposable.
- This machine has no Docker, so no local Supabase stack. `psql` 18 and the CLI via `npx` are present, but there are no database credentials.
- **Operator action needed:**
  1. Create or reset a disposable branch from production (or a restore project).
  2. Run `supabase db push` against it.
  3. Run `npm run release:verify-security`.
  4. Run the live suites with `.env.branch.local`-style environment variables.
  5. Run `supabase/rollback/core_platform_foundation.sql` on a second disposable database.
- **Validation not done:** clean-chain migration, incremental upgrade, `release:verify-security` and the live suites. None of these has run. They are not counted as passed.

### Local validation performed (PGlite, stubbed upstream objects; not a substitute for the above)
- Full run: 44 files passed, 4 skipped. 579 tests passed, 95 skipped. The skipped files are the `*.live.test.ts` suites that need a live database. `tsc --noEmit` is clean. `eslint .` shows 0 errors and 3 warnings. The warnings are in files this pass did not touch: `app/(app)/admin/content-factory/page.tsx`, `components/achievements/AchievementBadge.tsx`, plus one more.
- Rollback on a disposable database: applying the migration and then the rollback restores the public tables and views, the columns on `notifications`/`attempts`/`responses`, every function in `public`, `quizbox_ops` and `quizbox_sme` (compared by body hash) and the grant on `qb_student_insights()`. The stub bodies are byte-identical to the production definitions, so the comparison is meaningful. The one intentional leftover is the widened capability constraint on `user_capabilities`, a superset of the old one. The rollback also refuses once coin, payment, relationship or consent data exists.
- Catalogue security checks (in `core-platform.test.ts`):
  - RLS is on all 14 new tables.
  - Clients hold SELECT only, and `anon` holds nothing.
  - Every SECURITY DEFINER function pins `search_path`.
  - `anon` has no execute on any new function.
  - `qb_payment_apply_event`, `qb_qpoints_award` and `qb_coin_spend` are `service_role` only.
  - Internal `quizbox_core` functions are not executable by clients, apart from `is_staff` and `can_view_progress`.
- Safe defaults are verified against the migration's seed text: `flags.buy_coins_enabled=false`, `flags.student_self_pay=false`, `payments.providers=[]`, `coins.unit_price_minor={}`. With no provider and no price configured, `qb_payment_intent_create` raises `QB_FEATURE_DISABLED` or `QB_PROVIDER_NOT_ENABLED`.

### Guardian progress authorization
- New predicate `quizbox_core.can_view_progress(viewer, learner)`. It allows the learner themselves, a Super Admin, or an active, in-window, consented relationship with `can_view_progress=true`. It denies when the learner's consent is `withdrawn`. `can_fund` never implies visibility.
- It is applied at two existing places, with no new progress API:
  - `quizbox_ops.analytics_student`, which gates `qb_student_achievements` and `qb_student_competition_analytics`.
  - `qb_student_insights`, which gains an optional `p_student_id` that defaults to the caller. Zero-argument calls behave as before, and the client helper accepts an optional learner id.
- Teacher and school visibility is unchanged. It still flows through the existing class/tenant RPCs.
- Tests cover guardian allowed, guardian denied, a suspended relationship, withdrawn consent, a missing `can_view_progress`, sponsor with funding only, an unrelated user, a teacher with no relationship, an unauthenticated caller, and Super Admin.
- **Not covered:**
  - Direct table reads by guardians. RLS on `mastery_records`, `learning_events` and similar tables is unchanged, so guardians still cannot read them directly. They must go through the RPCs.
  - Other per-learner readers such as `qb_my_results_page` and `qb_get_attempt_review`. They are still own-data only.
  - The replacement of `qb_student_insights()` and `analytics_student` is in the unapplied migration. Production still has the old bodies until it is applied.

### Workspace integration
- New `components/WorkspaceProvider.tsx` and `useWorkspaceContext()`. `AppShell.tsx` wraps its `{children}` in the provider. Nothing else in the shell changed.
- Routes, navigation, UI and role gating are untouched. The provider fails soft: if `qb_my_roles` is not yet deployed, it sets `error` and nothing else happens.
- It reuses `useWorkspace`, so there is one `qb_my_roles` call for the shell, with no new membership queries. Switching goes through `switchTo`, which calls `qb_switch_workspace` and records the last-used workspace.
- **Not done:** nothing in the UI calls `switchTo` or reads `homeRoute` yet. There are no workspace-switch controls, no automatic navigation to the last-used workspace, and no component test (the repo has no jsdom setup).

### Coin spend
- `public.qb_coin_spend(user, amount, purpose, order_ref, idempotency_key, entitlement)` is callable by `service_role` only. It does the following in one transaction:
  - locks the wallet and checks the total balance;
  - consumes buckets in the configured order (`coins.spend_order`, default promotional then purchased);
  - writes one immutable ledger row per bucket with the order reference in its metadata;
  - optionally creates an access entitlement in `public.access_entitlements` (an order reference can be fulfilled once);
  - writes an audit entry.
- A replay with the same key returns the original result, and a different amount under the same key is a conflict.
- `post_coin` gained a metadata parameter. Server helper: `spendCoins` in `lib/core/payments.ts`. No UI and no marketplace code.
- Tests cover a successful spend, insufficient balance, a missing wallet, an invalid amount, a duplicate request, a changed amount, a duplicate order fulfilment, promotional-first, ledger immutability, and an unauthorised caller.

### Payment provider boundary
Sufficient as scaffolded: `PaymentProvider.verifyWebhook` returns the provider reference, status, amount and a reversal/refund status. `handlePaymentWebhook` and `applyVerifiedPaymentEvent` carry the verified event into the ledger RPC. There is no `createPayment` call on the interface yet. That is the one gap when the first real adapter is written. No PSP code was added.

### Question response types (inspection only)
- `questions.answer_type` plus `answer_spec` (snapshotted into assignment versions) is already an extensible response schema.
- Types handled in code today: SINGLE_CHOICE, TRUE_FALSE, NUMERIC. Images are supported through `question_media`.
- Not handled in grading or rendering: multiple response, matching, ordering, fill-blank, short response, passage, audio, video. The legacy `correct_answer` column is limited to A–D.
- Next pass: extend the grading RPC and `AnswerInput` per type. The schema does not need a new table.

### Deferred
- Everything under "Validation not done" above.
- A PSP adapter and `createPayment` on the interface.
- Wiring workspace switching and last-used routing into visible UI.
- Guardian-facing screens, and extending the guardian check to the remaining per-learner readers.
- Streak and badge awarding.
- Unifying the organisation tables.
- `learning_unit`, `learning_activity` and `recommendation`.
- The other question response types above.
- Whether the previous pass's earlier statements about coin spend and guardian progress being unbuilt still apply: both are now built, as described above.
