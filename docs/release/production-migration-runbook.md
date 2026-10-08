# Production deployment runbook: migrations 20261009100000, 20261010100000, 20261010110000

**Status: NOT EXECUTED. Blocked on production database credentials.** On 2026-10-06 the production pooler (`aws-0-eu-central-1`, user `postgres.fmgccmqxfjppqydkhaiu`)
rejected the password in the owner's `PGPASSFILE` (`password authentication failed`); the restore-project entry fails the same way, and the Supabase connector has no access to
these projects. One attempt was made per target and nothing was retried. Production has not been read from or written to.

Authorization on record: apply the three migrations above, conditionally, after Preview reconciliation passed (it did), with a recoverable backup first, history inspection, an exact
missing-set calculation, a divergence check, canonical order, and per-migration verification. **No blind `supabase db push`.**

## What was proven without production access
- The documented production chain is the 2026-10-03 backup baseline + **24** migrations (`20261002200000` to `20261005100000`). Replaying baseline + chain + the three migrations on a local scratch
  cluster succeeds (27 of 27), skipping `20261006100000`, `20261006110000`, `20261006120000`, `20261007100000`, `20261008100000` (not authorized).
- The three migrations are **independent of those five**: every object they touch is byte-identical whether or not the five are applied.
- Each migration is idempotent (re-applying is a no-op) and has a tested rollback in `supabase/rollback/`.
- Expected production fingerprints (before, and after each migration) are in `.local-backups/release-fingerprints/fp_expected_{pre,step1,step2,step3}.txt`.
  Regenerate with the scratch scripts if needed; compare with `scripts/release/compare-fingerprint.py`.

## 0. Preconditions (owner)
1. A working production connection. Fix the production entry in `PGPASSFILE` (or provide a new one), then confirm with a read-only `select 1`. Never paste passwords in chat.
2. Confirm Supabase-side backup/PITR status in the dashboard (informational; step 1 below is the recoverable copy this runbook relies on).
3. Pick a low-traffic window. The migrations are small transactions (function replacements, one new tiny table, a revoke); expected lock time is milliseconds.

## 1. Recoverable backup (read-only on production)
```
export PGHOST=aws-0-eu-central-1.pooler.supabase.com PGPORT=5432 PGDATABASE=postgres PGUSER=postgres.fmgccmqxfjppqydkhaiu PGSSLMODE=require   # PGPASSFILE supplies the password
D=.local-backups/prod-pre-20261009; mkdir -p $D
pg_dump -Fc -Z6 --no-owner --schema=public --schema='quizbox_*' -f $D/quizbox-prod.dump
pg_dump -Fc --data-only --table=supabase_migrations.schema_migrations -f $D/schema_migrations.dump
sha256sum $D/*.dump > $D/SHA256SUMS
pg_restore --list $D/quizbox-prod.dump > $D/restore-list.txt        # must succeed and list public + quizbox_* objects
```
Prove recoverability, not just existence: restore `quizbox-prod.dump` into a throw-away local database and compare row counts of `questions`, `attempts`, `assessments`, `profiles`
with production (`select count(*)` on both). Do not continue unless they match. The dump contains real user data: keep it in the git-ignored `.local-backups/` and handle as sensitive.

## 2. Inspect history and compute the exact missing set (read-only)
```
psql -c "select version, name from supabase_migrations.schema_migrations order by version"
```
Expected (from the 2026-10-02 reconciliation and the activation notes): production records timestamp-stamped versions for the 19 hardening migrations and nothing for
the early learning-engine files, so its history will **not** equal the repo. Therefore: **do not use `supabase db push`**. The missing set to apply is exactly
`20261009100000`, `20261010100000`, `20261010110000` (verify none is already present; each is idempotent anyway). `20261006100000`-`20261008100000` stay unapplied (not authorized).
Production history repair (`docs/production-migration-reconciliation.md`) is a separate action that is **not** authorized here.

## 3. Confirm no unexpected schema divergence (read-only)
```
psql -At -F '|' -f scripts/release/schema-fingerprint.sql > $D/fp_production_before.txt
python scripts/release/compare-fingerprint.py $D/fp_production_before.txt .local-backups/release-fingerprints/fp_expected_pre.txt --ignore-env
```
Expected: exit 0. Then run it **without** `--ignore-env` and review the grant differences by hand (production's default ACLs are older/looser than Preview's, so function/table
grants on objects created after that change may differ legitimately). **Stop on any structural difference** (columns, constraints, indexes, function bodies, policies, triggers).
Note the migration `20261009100000` ingest edit is guarded: it aborts with `INGEST_DUPLICATE_CONTRACT_MISMATCH` if production's `core_qb_content_ingest` text differs from what was rehearsed,
which is the intended safety net, not an error to bypass.

## 4. Apply, one at a time, in canonical order (each file carries its own transaction)
For each of `20261009100000_throttle_and_scoped_duplicates`, `20261010100000_admin_rpc_budget_order`, `20261010110000_auth_failure_hardening`:
```
psql -v ON_ERROR_STOP=1 -X -f supabase/migrations/<file>.sql
psql -At -F '|' -f scripts/release/schema-fingerprint.sql > $D/fp_production_after_stepN.txt
python scripts/release/compare-fingerprint.py $D/fp_production_after_stepN.txt .local-backups/release-fingerprints/fp_expected_stepN.txt --ignore-env     # must exit 0
```
Then the per-migration checks below. If anything is off, stop and run the matching rollback (`supabase/rollback/<name>.sql`, applied in reverse order).

| Step | Verify (read-only) |
|---|---|
| 1 `20261009100000` | `qb_start_attempt` body contains `consume_budget` before `assessment_allowed`; `core_qb_content_ingest` body contains `qc.market_id` and `question_allowed(u.id)`; ACLs of both unchanged (`authenticated`, `service_role`, `postgres`; no `anon`, no `PUBLIC`) |
| 2 `20261010100000` | `qb_content_ingest`, `qb_content_request_generation`, `qb_content_review` each have `consume_budget` before the gate and the gate inside the inner block; ACLs unchanged |
| 3 `20261010110000` | `qb_auth_failure` ACL = `postgres`, `anon`, `authenticated`; `has_table_privilege('anon'|'authenticated','public.system_events', …)` false for all privileges, `service_role` still true; `quizbox_private.auth_failure_budget` exists and anon cannot select it; `quizbox_private.purge_auth_failures` not executable by anon/authenticated; index `system_events_type_idx` present |

Policies: none of the three migrations creates or alters a policy; the fingerprint `pol` lines must be identical to `fp_expected_pre.txt` at every step.

## 5. Record history (after step 4 passes)
Insert only the three canonical rows (names above) into `supabase_migrations.schema_migrations`, only for migrations actually applied. Do not touch any other history row.

## 6. After deployment
- Smoke: anonymous `qb_auth_failure('invalid_credentials')` returns without error and writes one row; an authenticated client cannot `select` from `system_events`; a student can start an attempt.
- Add `qb_auth_failure` to `lib/operations/public-rpc-allowlist.ts` (and flip the `closure.live` expectation to an empty list) **only after** production passes step 3's checks.
- Do not delete production fixture data (separate, pending the production inventory).
