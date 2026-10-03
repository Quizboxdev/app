# Production activation checklist

Target: `fmgccmqxfjppqydkhaiu`. Rehearsed on preview branch `fngdtxayfoiffbcbmcum`
(sponsor-delivery-data). **None of these steps has been performed on production.**
Each step needs an owner, a timestamp and captured evidence. Stop on the first failure.

| # | Step | How | Pass evidence |
| --- | --- | --- | --- |
| 0 | Release preflight | `npm run release:validate` then `npm run release:preflight` (read-only). | `reports/release-preflight.json` pass=true. |
| 1 | Reconcile migration history | Follow `docs/production-migration-reconciliation.md` (fetch 4 initial files, repair 7 + 19 applied, retire 19 duplicates). | `migration list` aligned; `db push --dry-run` lists only `20261002200000`–`20261002280000`. |
| 2 | Verified production backup | Custom-format `pg_dump` (schema + data incl. auth linkage) via operator `PGPASSFILE`; storage objects exported separately (`docs/final-release-actions.md`). | Archive checksum recorded; stored encrypted, off Git. |
| 3 | Isolated restore verified | `scripts/restore-isolated.ps1 -ConfirmIsolatedRestore` into a disposable project; compare counts/checksums. | Restore report matches production counts. |
| 4 | Enable leaked-password protection | Dashboard > Authentication > Attack Protection. | Security Advisor no longer reports `auth_leaked_password_protection`. |
| 5 | Verify Auth redirects | Site URL + redirect allow-list include the production origin and `/auth/reset-password`. Rotate acceptance accounts if not done. | Reset link round-trip on production origin; old acceptance passwords fail. |
| 6 | Apply migrations in order | `supabase db push --linked` (after step 1) applying: `20261002200000_market_sme_foundation`, `210000_content_market_enforcement`, `220000_sponsor_competition_lifecycle`, `230000_sponsor_authenticated_workflows`, `240000_sponsor_candidate_review_bridge`, `250000_sponsor_source_delivery`, `260000_legacy_node_attribution`, `270000_competition_review_operations`, `280000_hot_path_performance`, then the multi-country set `20261003100000_multi_market_platform`, `110000_country_first_signup`, `120000_market_grade_codes`, `130000_market_content_grades`, `140000_market_setup_curricula`, `150000_editorial_market_grades`, `160000_sme_queue_predicate_grant`, `170000_continuous_attribution`, `180000_sme_review_guard_alias`, `190000_class_policy_row_check`, `200000_self_serve_tenant_access`, then `20261004100000_activity_search_home`, `110000_quality_analytics_home`, `120000_competition_school_admin_ops`, then `20261005100000_content_factory`. Each is transactional; stop on error. Configure each live market's education data in Market Setup before opening signup (the signup form only offers configured grades). Never enable `TEST_MARKETS_VISIBLE` in production. | All 24 recorded; no partial objects. Then run `scripts/release-data-verification.sql` (all rows pass). |
| 7 | Verify grants / RLS | Run the catalog checks in `docs/security-release-review.md` (competition schema exposes only `dispatch`, `storage_access`, `raw_question_allowed`; private tables RLS on, no table grants). Bootstrap the first `super_admin` with the documented SQL (`docs/market-sme-foundation.md`). | Query output attached. |
| 8 | Security Advisor | Dashboard or `supabase db advisors --linked --type security`. | 0 ERROR; no finding types beyond `docs/security-release-review.md`. |
| 9 | Performance Advisor | `supabase db advisors --linked --type performance`. | 0 ERROR; hot-path FK indexes present. |
| 10 | Ghana baseline smoke | Grade-matched student: `/student/assessments` lists assignments; start → answer → submit → result; teacher sees the result. Verify `market_attribution_issues` queue reviewed (`GH-SOURCE` authority, unattributed questions). | No `QB_CONTENT_SOURCE_DENIED` for governed content. |
| 11 | Role acceptance | Student, teacher, SME (queue, excerpt, approve/revise/reject), sponsor (workspace), admin/super admin (markets, SME management, oversight, review assignment). | Per-role pass log. |
| 12 | Sponsor E2E smoke | Test sponsor only: draft → upload → extract → approve source → generate (configured provider or disabled) → assign (content admin) → review → bank → snapshot → publish → register → attempt → official result → leaderboard → analytics → oversight. | Each state persisted; no cross-sponsor access. |
| 13 | Deploy compatible frontend | Deploy the build containing `lib/competition/local-gate.ts` and the new pages. Content Factory generation stays disabled until `QUIZBOX_GENERATION_PROVIDER/MODEL/ENDPOINT` are configured for production; do not configure the branch mock provider. The sponsor engine stays **disabled on production** until explicitly enabled (gate blocks the production ref). | Deployment id recorded; production gate verified closed. |
| 14 | Post-deploy verification | Repeat steps 10–11 on the deployed URL; check logs for 4xx/5xx spikes; run `npm run release:check`. | Clean logs, checks pass. |
| 15 | Rollback decision | Go/no-go. Rollback order: `rollback/content_factory.sql` (refuses once campaigns/policies exist) → `rollback/hot_path_performance.sql` → `competition_review_operations.sql` → `legacy_node_attribution.sql` → `sponsor_source_delivery.sql` → `sponsor_candidate_review_bridge.sql` → `sponsor_authenticated_workflows.sql` → `sponsor_competition_lifecycle.sql`. Rollbacks refuse populated workflow data; beyond that use the step-2 backup via an isolated restore. | Decision and signer recorded. |
| 15b | Post-activation: curriculum source registry | Production already has the first 24 migrations (applied 2026-10-03). With owner authorization, apply `20261006100000_curriculum_source_registry` (`supabase db push --linked`), then configure each authority's official domains in Admin → Curriculum Sources before importing packs. Rollback: `rollback/curriculum_source_registry.sql` (refuses once packages exist). | Registry verified; release-data verification passes. |
| 16 | Delete data-cloned branch | After evidence capture: `supabase branches delete sponsor-delivery-data --project-ref fmgccmqxfjppqydkhaiu`. It contains copied production user data. | Branch absent from `branches list`. |

Known decisions for the owner before step 10:
* `student.test` (grade B7) is correctly denied SHS1 assignments by the grade-match rule; only
  grade-matched students see legacy content. Confirm this is the intended policy for teacher-assigned work.
* `GH-SOURCE` (337 nodes, 0 questions) has no recorded authority; map only with official provenance.
* 2 legacy questions (`QBTEST`, inactive, no node) remain in the manual review queue.
* The 30 attributed `DEV_ACCEPTANCE_FIXTURE` questions are acceptance fixtures; remove from production
  before public release as already planned.
