> **v1 is superseded.** The v1 dry run hit a hard blocker and an insufficient scope. Do not run `production-cleanup.sql`. Use the v2 dry run below.

# Production test-tree cleanup: run guide

Files: [production-cleanup-dry-run.sql](production-cleanup-dry-run.sql) (read-only) and [production-cleanup.sql](production-cleanup.sql) (executes).
Neither has been run against production, Preview or any hosted project. Both were validated only on a throw-away local database built from the production-state schema (see "Validation").

## How to run
1. Confirm the 2026-10-06 15:41 production backup is the one you intend to rely on. There is **no undo script**: deletions are irreversible, the backup is the rollback.
2. Run **the dry run** in the Supabase SQL editor (one execution). It makes the database itself refuse writes (`SET TRANSACTION READ ONLY` after building its temp sets), and returns one table. Review:
   - `precheck (must be 0)`: all eleven rows must be 0 (the four evidence counts, then the same checks with the removal definitions).
   - `would-delete`: rows per table. `users` / `questions`: how many would be deleted vs **retained**, and why. `user list`: every removable account and its fate.
   - `admin.test present (kept, never touched)` must be 1.
3. Run **the cleanup** in one execution. It is a single transaction: any failed assertion raises and nothing is committed. The result table at the end has the before/after counts, the retained list with the database's own reason, and every assertion.
   If the editor reports `relation "s_users_rm" does not exist`, it ran the statements on separate sessions; use `psql -f` against the pooler instead.

## What it removes
Plain deletes, FK-safe order, any surprise aborts everything: responses, learning events, XP rows, results, gradebook, attempts, assignment targets, question versions, assignments, assessment questions, fixture-only assessments, mastery, notifications, class memberships, fixture classes.
Per-item (savepoint) deletes, failures retained and reported: fixture questions, disposable users (and their profiles, role profiles, capabilities, market/tenant/institution memberships, SME and sponsor profiles, seller rows, and ledger/wallet rows if those tables exist), `QB_TEST*` tenants, `is_test` markets.

## What it keeps, by design
- `admin.test@quizbox.local`, and every genuine row (user, class, assignment, assessment, question, attempt, membership counts are asserted identical before and after).
- All immutable history: `legacy_content_attributions`, `content_contexts`, SME/factory/source event tables. No trigger is disabled (asserted: `immutable_legacy_attribution` stays enabled and the count of non-default triggers is unchanged).
- Audit logs and system events (not in the removal scope).
- **Retained historical residue** (reported, then neutralised without touching history): a fixture question with an attribution stays as an **inactive** row; a disposable user referenced by immutable or out-of-scope history stays with profile `inactive`, sign-in banned, capabilities/market memberships/SME roles deactivated; a test market that curricula/attributions still reference stays.

## Validation performed (local only)
Production-state schema = the 2026-10-03 production backup plus the documented 24-migration chain (production does not have `20261006100000`–`20261008100000`, so wallet/ledger tables are absent and the script skips them).
Synthetic data covered genuine and fixture users, classes, assignments, assessments, attempts, results, XP, events, mastery, notifications, an attributed fixture question, unattributed fixture questions, a test tenant, a test market with attributions, and a user pinned by an immutable content context.
- Dry run changed nothing (row-count fingerprint of every table identical before and after) and predicted exactly what the cleanup then did.
- Cleanup: 6 users deleted, 1 retained; 2 questions deleted, 1 retained inactive; tenant deleted; market retained; all genuine counts unchanged; immutable trigger untouched; every assertion passed.
- Planting a genuine member in a fixture class aborted the script before any delete with the database unchanged. Re-running on a cleaned database deleted nothing and passed.

## Known limits
- The script targets the production schema as reconstructed (backup + documented chain), not a live read of production; the dry run will fail early, changing nothing, if a table it needs is missing.
- Rows in tables outside the removal scope that reference a disposable user (competition, factory, SME payout, import batches, …) keep that user retained. If the dry run lists many such users, decide whether to widen scope before running.
- Stale test import batches are not in scope and are not touched.


## v2 dry run (current): `production-cleanup-dry-run-v2.sql`
Read-only (the database is switched to READ ONLY before the engine runs; only temp tables are written). One result table. Runs in about 4 seconds on the validation data.

**What it computes.** From the live foreign-key catalog it finds the largest set of rows that are test-owned, deletable, and not referenced by anything that has to stay:
1. Seeds: removable test users (admin.test excluded), fixture classes/assignments/assessments/questions, `QB_TEST*` tenants, `is_test` markets.
2. Expansion: child rows in the Competition, SME, Sponsor and Content tables, only if every user reference on the row is NULL or a removable user (rows with no user reference follow their container parent: a response follows its attempt, an assessment question its assessment, a competition stage its competition). Anything a genuine user touches is never added.
3. Pruning to a fixed point: a row leaves the set if any row that stays still references it, under any FK action. Rows that stay are immutable history (found from the live catalog and listed in the output), tables outside the cleanup scope, and genuine rows. Retention propagates up the foreign keys, so parents of a retained immutable row stay as the minimum footprint. Identity rows (`auth.*`, profiles) travel with a retained account.

**Result sections.** `PROPOSAL 1 Competition / 2 SME / 3 Sponsor / 4 Content / 5 Identity / 6 Other` (per table: test-owned rows found, immutable rows kept, rows kept because an immutable row references them, rows kept for other reasons, rows proposed for deletion); `ATTEMPTS` (deletable vs retained, and how many are held by immutable competition records); `USERS` (each account: DELETE or RETAIN with the root blocker); `QUESTIONS`; `MARKETS/TENANTS`; `WHY ROWS STAY` (root blockers); `AUDIT ROWS KEPT, ACTOR NULLED`; `IMMUTABLE TABLES (live catalog)`; and the precheck block, which must read 0 everywhere, including `closure self-check`.

**Decision you must make before any execute script: SET NULL on audit tables.** `audit_logs.actor_user_id` (and `analytics_events`, `admin_actions`) are `ON DELETE SET NULL`. Treating them as blockers would retain every account that ever produced an audit row, i.e. all of them. v2 therefore treats those links as non-blocking: the audit rows are NOT deleted, only the actor column becomes NULL, as the existing foreign key already does for any deleted user. The output lists how many rows that touches. If you do not accept that, empty the `_setnull_ok` insert near the top of the script and re-run: you will then see which users stay because of audit rows.

**Other tables that reference users but are outside the cleanup scope** (for example `content_import_batches`, `entitlements`, `orders`, `transactions`, `support_tickets`, `quizbox_factory.*`) are never touched; if they hold rows for a removable user, that user stays and the table appears under `WHY ROWS STAY`. Widening scope is a separate decision.

**Validation (local, production-state schema, synthetic data).** Competition trees pinned by immutable snapshot/registration/participation/official-result rows, a genuine entrant in a test-created competition, SME and sponsor accounts pinned by immutable review events, compensation-policy versions and content contexts, and fully mutable test trees. Read-only confirmed (row-count fingerprint of every table unchanged). The proposed set was then actually deleted in a rolled-back transaction: all rows deleted, immutable and genuine rows untouched, trigger still enabled.
Not predictable without production access: how many of the 18 users become deletable. That depends entirely on what the production data contains.


## v2 execute (final review copy): `production-cleanup-v2.sql`  -- NOT YET AUTHORISED TO RUN
Generated by `scripts/release/build-cleanup-v2.py`: the sets, engine definitions and engine run are copied byte-for-byte from the reviewed dry run; the header carries the sha256 of those slices and `lib/operations/cleanup-v2.test.ts` re-checks it.

**Before running:** re-run the v2 dry run immediately beforehand; its numbers must equal the `_expect` table near the top of the execute script (rows proposed 1,154; removable users 18, retained 11; fixture attempts retained by competition history 13; fixture questions 43, all retained). Edit `_expect` only if the new dry-run is reviewed and different. Run it while nobody is using the admin/UAT accounts: exact-equality assertions on genuine data and on `admin.test` will abort (harmlessly) on live writes, and the script can simply be re-run.

**What it does, in order:** one transaction; engine; frozen plan keyed by primary key; pre-flight assertions (every genuine-link count and the closure self-check = 0, counts equal `_expect`, no plan row in an immutable table, none for `admin.test`, none in a competition-snapshot assessment, SET NULL tolerance limited to the three telemetry tables); ordered deletion of exactly the plan (children first by retry passes; if a foreign-key cycle blocks progress, only nullable references between rows already in the plan are nulled); retained test accounts disabled (profile inactive, sign-in banned, sessions and one-time tokens revoked, capabilities/memberships/SME roles deactivated); retained fixture questions set inactive; post assertions; `COMMIT`; one before/after report.

**Post assertions (any failure aborts and nothing is committed):** no table lost a row other than its planned rows (every table in `public`, `auth`, `quizbox_*`); immutable tables unchanged, one line each; audit/telemetry rows not deleted; genuine users, classes, assignments, assessments, attempts, questions and memberships unchanged; trigger, RLS-flag and policy fingerprints identical to before; `immutable_legacy_attribution` still enabled; `admin.test` rows and the rows referencing it byte-identical; competition-linked fixture attempts preserved; retained fixture questions not active; retained test users not able to sign in, no sessions, no active roles; test markets absent from `qb_signup_markets()`; no non-test user holds an active membership in a test market.

**Known behaviours to expect:** `audit_logs.actor_user_id` becomes NULL for rows by deleted users (reported with the count); `question_versions` of retained fixture questions are in the reviewed delete set, and the status change on those questions makes the existing version-capture trigger write a fresh version row; a user retained only because of a retained parent shows the parent as the blocker.

**Validation (local, production-state schema):** dry run read-only confirmed; execute committed with all assertions passing on seeded competition/SME/sponsor trees including a deliberate foreign-key cycle; aborts with the database unchanged when (a) expected counts differ, (b) a genuine member is planted in a fixture class, (c) a hidden trigger deletes an extra genuine row during a planned delete.
