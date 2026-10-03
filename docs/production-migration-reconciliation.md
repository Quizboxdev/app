# Production migration reconciliation (plan only — nothing executed)

Production: `fmgccmqxfjppqydkhaiu`. Evidence gathered with read-only catalog queries
(`supabase db query --linked` from an isolated scratch link) on 2026-10-02. **No history
repair, migration or DDL was run against production.**

## Current state

* Production history has 23 rows. 4 (`20260926*`) have no local file; 19 are the same SQL as local
  files but were recorded under different timestamps (applied via SQL editor/connector).
* 7 local migrations were applied to production physically but never recorded (below).
* 9 local migrations (`20261002200000`–`20261002280000`) are not applied to production.

Because local and remote version numbers disagree, `supabase db push` against production would
try to re-run 26 already-applied migrations. History must be reconciled before any push.

## A. Physically applied, unrecorded (7)

All objects verified present on production (47/47 catalog checks passed).

| Version | File | Principal objects | Proof on production | Material SQL differences | Repair |
| --- | --- | --- | --- | --- | --- |
| 20261001160000 | core_learning_engine.sql | tables `curricula`, `curriculum_nodes`, `content_import_batches`, `question_import_staging`, `assignment_question_versions`, `learning_events`, `mastery_records`, `xp_transactions`; 16 columns on `assignments`/`classes`/`questions`; functions `qb_join_class`, `qb_proficiency`, `qb_question_availability`, `qb_student_xp`; 10 indexes | all tables, columns, functions and indexes exist | none (BOM removed locally only) | **SAFE** |
| 20261001180000 | fix_curriculum_node_identity.sql | `curriculum_nodes.identity_key` | column exists, no null keys | none | **SAFE** |
| 20261001190000 | canonical_curriculum_identity.sql | data: recompute `identity_key` | no null keys | none | **SAFE** |
| 20261001200000 | grade_canonicalization.sql | `source_grade_code`/`canonical_grade_code` on nodes and questions + backfill | columns exist; no question with a grade lacks a canonical grade | local file later added `grade::text` casts (enum compatibility); same intent | **SAFE** (record as applied; do not re-run) |
| 20261001210000 | learning_loop_rpcs.sql | `qb_complete_attempt`, `qb_publish_assignment` | both exist (later wrapped by recorded `production_readiness_security`) | superseded by later recorded migrations | **SAFE** |
| 20261002120000 | targeted_remediation_publish.sql | `qb_publish_assignment` (targeted remediation) | production body contains the corrected `'active'::public.qb_status` | local file edited after apply (`'ACTIVE'` → `'active'::qb_status`); production already has the corrected form | **REVIEW → SAFE** (production matches the edited file) |
| 20261002130000 | fix_learning_loop_status_enum.sql | `qb_complete_attempt` status enum fix | body present | none | **SAFE** |

## B. Recorded under different versions (19)

Content compared with `supabase migration fetch` output: identical apart from comments and a
trailing `;`. Local version → production version:

| Local | Production |
| --- | --- |
| 20261002140000_secure_practice_feedback | 20261001230902 |
| 20261002141000_skip_zero_xp_award | 20261001232209 |
| 20261002150000_question_factory_governance | 20261001234546 |
| 20261002151000_question_factory_input_hardening | 20261001235655 |
| 20261002152000_learning_rpc_context_hardening | 20261002000118 |
| 20261002153000_editorial_batch_metrics | 20261002000607 |
| 20261002154000_class_owner_returning_policy | 20261002000919 |
| 20261002155000_class_owner_tenant_boundary | 20261002001053 |
| 20261002160000_content_pagination_bounds | 20261002001304 |
| 20261002161000_assessment_snapshot_editorial_proof | 20261002001807 |
| 20261002162000_rich_content_key_allowlist | 20261002002018 |
| 20261002163000_editorial_contract_bounds | 20261002002510 |
| 20261002164000_validator_json_aliases | 20261002002944 |
| 20261002170000_production_readiness_security | 20261002004957 |
| 20261002171000_coverage_targets_media | 20261002005256 |
| 20261002172000_legacy_privilege_boundary | 20261002005449 |
| 20261002173000_failed_operation_budget_boundary | 20261002064205 |
| 20261002174000_final_review_pagination | 20261002064439 |
| 20261002175000_media_registry_write_grants | 20261002065235 |

Classification: **SAFE** to align (no SQL to run; history bookkeeping only).

## C. Production-only initial migrations (4)

`20260926180457_initial_quizbox_jhs_schema`, `20260926180522_institutions_levels_access`,
`20260926184037_question_import_metadata`, `20260926185133_question_import_merge_helper`.
Add these files to `supabase/migrations/` (from `supabase migration fetch`) so local history
starts where production does. Note: production was also built partly outside migrations
(e.g. `qb_is_platform_admin()` exists in no file) — a full rebuild from files fails; see "Long term".

## Proposed commands (DO NOT RUN until checklist step 1 is authorized)

From a checkout linked to production (`supabase link --project-ref fmgccmqxfjppqydkhaiu`),
after a verified backup:

```bash
# 0. Inspect first; expect the mismatch described above.
supabase migration list --linked

# 1. Bring the 4 production-only initial files into the repo (no database change).
supabase migration fetch --linked   # then keep only the four 20260926* files in supabase/migrations

# 2. Record the 7 physically-applied migrations (group A).
supabase migration repair --linked --status applied \
  20261001160000 20261001180000 20261001190000 20261001200000 20261001210000 20261002120000 20261002130000

# 3. Record the 19 local versions (group B) as applied ...
supabase migration repair --linked --status applied \
  20261002140000 20261002141000 20261002150000 20261002151000 20261002152000 20261002153000 \
  20261002154000 20261002155000 20261002160000 20261002161000 20261002162000 20261002163000 \
  20261002164000 20261002170000 20261002171000 20261002172000 20261002173000 20261002174000 20261002175000

# 4. ... and retire their duplicate production-only versions.
supabase migration repair --linked --status reverted \
  20261001230902 20261001232209 20261001234546 20261001235655 20261002000118 20261002000607 \
  20261002000919 20261002001053 20261002001304 20261002001807 20261002002018 20261002002510 \
  20261002002944 20261002004957 20261002005256 20261002005449 20261002064205 20261002064439 20261002065235

# 5. Verify: only 20261002200000..20261002280000 remain pending.
supabase migration list --linked
supabase db push --linked --dry-run
```

`migration repair` edits only `supabase_migrations.schema_migrations`; it runs no migration SQL.
Step 4 must not be run without step 3 in the same session.

## Long term

Take a schema-only baseline of production (`supabase db dump --schema-only` with Docker, or
`pg_dump --schema-only`), commit it as a single baseline migration, and squash pre-baseline files,
so a fresh branch can be built from files alone.
