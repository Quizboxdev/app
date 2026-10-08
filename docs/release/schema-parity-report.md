# Schema parity report: repository migration chain vs Preview

2026-10-06. Preview = `fngdtxayfoiffbcbmcum`. Production and the active Preview were not touched by the replay.

## Method (and one deviation you should know about)
- **Scratch target.** The approved restore-test project (`fwuucvpmwetkwnczmgbp`) could not be used: the stored password was rejected by its pooler
  (`password authentication failed`; the alternate pooler region reports the tenant as absent). I stopped after two connection attempts and did not retry
  credentials. The replay therefore ran on a **local, throw-away PostgreSQL 18 cluster** bound to 127.0.0.1 in the scratch directory. It can be repeated on the
  restore project once its password is fixed.
- **Baseline.** The repo migrations are not self-contained (`qb_is_platform_admin()` and others exist in no file). The baseline is therefore the
  pre-activation production backup `.local-backups/release-2026-10-03T10-37-47Z/quizbox.dump` (checksum verified), restored schema-only. It already contains the
  repo chain through `20261002175000` as it existed in production. Every later repo migration (32 files, `20261002200000` to `20261010110000`) was then replayed in
  canonical order: **32 of 32 applied without error.**
- **Comparison.** `fingerprint.sql` compares, for `public` and every `quizbox_*` schema: schemas, relations (kind, RLS, force-RLS, options), every column (type, nullability,
  default, identity, generated, collation), constraints (full definition), indexes (full definition), triggers (full definition and enabled state), **full function bodies**,
  policies (command, roles, USING, WITH CHECK), effective grants for `anon`/`authenticated`/`service_role` on tables, sequences, functions and schemas, column ACLs, views,
  enum/domain types, extensions, plus triggers on `auth.users`, policies on `storage.objects`, and the three storage buckets. About 4,650 facts per side.
- **Default ACLs.** New-object grants depend on `pg_default_acl`. Preview uses the stricter current defaults; the restored production baseline carries production's older
  ones. The replay was run with Preview's defaults so that grants reflect migration content, not environment.

## Result: Preview before this pass
Differences found: `school_performance` not applied (function, `qb_school` body, grants). Everything else identical.

## Result: Preview after applying `20261008100000_school_performance`
Identical in all compared facts except four items, none of them drift:

| Item | Explanation |
|---|---|
| Unique constraint/index on `quizbox_sources.registry` (`…_subject_code_k` vs `…_subject_co_key`) | Auto-generated name truncated differently by PostgreSQL 17 (Preview) and 18 (scratch). Same definition. |
| `pg_net` extension present on Preview only | Supabase-managed; no repo migration references it. |
| `question-media` bucket size/MIME limits | Bucket rows are data, not schema; the schema-only baseline cannot carry them. Preview has the limits the migration sets (5 MiB; png/jpeg/webp). |
| (none further) | |

## `merge_quizbox_question_import` (history drift, intentionally not recreated)
Evidence: created only by `20260926185133_question_import_merge_helper` (recorded as applied on 2026-09-26) but **absent from the 2026-10-03 production backup and from Preview**.
It reads `public.quizbox_question_import_stage`, a transient import-tool table that exists in neither. No code, test, script or doc references it; nothing depends on it; the
content-import pipeline (`content_import_batches`, `question_import_staging`, `qb_content_ingest`) replaced it. Git history has a single commit, so there is no earlier removal record.
Classification: **intentionally retired dead helper; history drift documented, not recreated.** (A fresh build from files would still create it, revoked from all API roles.)
The `questions_external_question_id_uidx` index is likewise named `…_unique` in the production baseline and on Preview.

## Not covered
- Data (rows) is not compared; only schema objects and their definitions.
- Platform-managed schemas (`auth`, `storage`, `realtime`, …) beyond the migration-relevant items above.
- The fingerprint is a deep comparison, not `pg_dump` text equality; ordering/formatting-only differences are normalised.
