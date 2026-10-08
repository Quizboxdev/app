# Migration reconciliation plan (Preview `fngdtxayfoiffbcbmcum`)

Status: **analysis only. Nothing in migration history or production has been changed.** Written 2026-10-06.
Evidence: repo `supabase/migrations/*.sql` (62 files), `supabase_migrations.schema_migrations` on Preview (50 rows), and an object-level check of every
object each migration creates (624 tables/functions/indexes/triggers/types/schemas) against Preview's live catalogs.
Limit of the evidence: object *existence* is verified for every file; function/policy *bodies* are not (see step 2).

## What the three sources say

| Group | Files | Preview history | Preview schema | Meaning |
|---|---|---|---|---|
| A. Renumbered | 19: `20261002140000_secure_practice_feedback` … `20261002175000_media_registry_write_grants` | present under **different version stamps** (e.g. `20261001230902_secure_practice_feedback`), same names | all objects present | applied through the tooling at timestamp versions, then renumbered in the repo |
| B. Never recorded | 7: `20261001160000_core_learning_engine`, `…180000_fix_curriculum_node_identity`, `…190000_canonical_curriculum_identity`, `…200000_grade_canonicalization`, `…210000_learning_loop_rpcs`, `20261002120000_targeted_remediation_publish`, `…130000_fix_learning_loop_status_enum` | **no row** | all objects present | applied outside the history table (branch creation or direct apply) |
| C. Never recorded | `20261007100000_core_platform_foundation` | no row | 53 of 53 objects present | direct-applied |
| D. **Not applied** | `20261008100000_school_performance` | no row | `quizbox_ops.school_performance` missing; `public.qb_school` lacks it | genuinely pending on Preview |
| E. Direct-applied this week | `20261009100000_throttle_and_scoped_duplicates`, `20261010100000_admin_rpc_budget_order`, `20261010110000_auth_failure_hardening` | no row | all objects present; each is idempotent | applied with `psql`, by design not recorded |
| F. Recorded but drifted | `20260926184037_question_import_metadata`; `20260926185133_question_import_merge_helper` | exact rows | unique index exists under another name (`questions_external_question_id_unique` vs `…_uidx`); `public.merge_quizbox_question_import` **does not exist** | removed/renamed out of band; the helper is referenced by no application code |
| OK | the remaining 25 files (everything up to `20260926…` and the sponsor/content-factory/analytics series) | exact rows | all objects present | consistent (the apparent "missing" indexes are in non-`public` schemas) |

Why it matters: `supabase db push` compares repo versions with history. As things stand it would try to re-apply groups A–C (most are not idempotent and would
fail), apply D (correct), and re-run E (safe, idempotent). A prior partial attempt exists in `.local-backups/recon-group-c/` (not used here).

## Recommended approach (repo files are the source of truth)

1. **Freeze direct applies to Preview** until this is done. (Group E was applied directly only to run the live acceptance suite.)
2. **Prove parity before touching history.** Existence is verified; bodies are not. Replay all 62 repo migrations, in order, into an empty scratch database and compare
   `pg_dump --schema-only` (excluding Supabase-managed schemas) with Preview. Docker is not available here, so the scratch target must be a throwaway Supabase project/branch.
   **Option:** reset and use the soon-to-be-retired restore-test project (`fwuucvpmwetkwnczmgbp`). This overwrites that project, so it needs your explicit approval.
   Any difference is classified as: repo is right (re-apply to Preview), Preview is right (write a forward migration), or intentional (document).
3. **Resolve group F in the repo, forward only.** Decide for `merge_quizbox_question_import` whether it was intentionally removed (add a forward migration
   `drop function if exists …`) or must exist (recreate on Preview from the file). Rename the index forward-only if the name matters. Never edit applied migrations.
4. **Repair history on Preview** only after step 2 is clean, as one reviewed transaction ([migration-history-repair.sql](migration-history-repair.sql), *not executed*):
   - Group A: delete the 19 old-stamp rows and insert the 19 repo versions with the same names (equivalent to `supabase migration repair --status reverted <old>` then `--status applied <new>`).
   - Groups B, C, E: insert rows for the repo versions (`--status applied`).
   - Group D: **apply the file**, then record it. Do not mark it applied without applying it.
   - Group F: no history change (rows are correct); the drift is fixed by step 3.
   The same can be done with `npx supabase migration repair` (CLI 2.119 is available via `npx`), but that needs a linked project and an owner-held access token; the SQL route
   uses only the Preview connection already used for the live tests.
5. **Verify:** `select version,name from supabase_migrations.schema_migrations` equals the repo file list exactly (62 rows, same order); re-run the object check; run
   `npm run acceptance:live`; a dry `supabase db push --dry-run` (if a token is available) must report nothing to apply.
6. **Production comes last and separately.** Per the activation notes, production recorded the first 24 migrations from the repo, so its history probably matches the repo
   versions for those. Read production's history first (read-only, in the SQL editor: `select version,name from supabase_migrations.schema_migrations order by 1`), then
   apply the same classification. Production needs your explicit authorization for every migration that is not yet applied there; nothing in this plan touches it.
7. **Prevent recurrence:** a read-only parity check in `release:preflight` (repo files vs history rows) and "no direct applies, no renumbering after apply" as a rule.

## Decisions needed from you
- Approve step 2's scratch target (restore-test project, overwritten) or name another throwaway project.
- Group F: was `merge_quizbox_question_import` meant to be removed?
- Approve step 4 for Preview after step 2 passes.
