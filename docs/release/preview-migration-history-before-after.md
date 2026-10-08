# Preview migration history: before and after (2026-10-06)

Preview `fngdtxayfoiffbcbmcum` only. Production untouched. Backup of the before state: `.local-backups/preview-history/schema_migrations-before-2026-10-06.json`.
Before: 50 rows. After: 62 rows, identical to the 62 repo migration files (versions and names).

| Repo version | Name | Version in history BEFORE | Action |
|---|---|---|---|
| 20260926180457 | initial_quizbox_jhs_schema | 20260926180457 | unchanged |
| 20260926180522 | institutions_levels_access | 20260926180522 | unchanged |
| 20260926184037 | question_import_metadata | 20260926184037 | unchanged |
| 20260926185133 | question_import_merge_helper | 20260926185133 | unchanged |
| 20261001160000 | core_learning_engine | absent | recorded (was absent) |
| 20261001180000 | fix_curriculum_node_identity | absent | recorded (was absent) |
| 20261001190000 | canonical_curriculum_identity | absent | recorded (was absent) |
| 20261001200000 | grade_canonicalization | absent | recorded (was absent) |
| 20261001210000 | learning_loop_rpcs | absent | recorded (was absent) |
| 20261002120000 | targeted_remediation_publish | absent | recorded (was absent) |
| 20261002130000 | fix_learning_loop_status_enum | absent | recorded (was absent) |
| 20261002140000 | secure_practice_feedback | 20261001230902 | re-keyed from `20261001230902` |
| 20261002141000 | skip_zero_xp_award | 20261001232209 | re-keyed from `20261001232209` |
| 20261002150000 | question_factory_governance | 20261001234546 | re-keyed from `20261001234546` |
| 20261002151000 | question_factory_input_hardening | 20261001235655 | re-keyed from `20261001235655` |
| 20261002152000 | learning_rpc_context_hardening | 20261002000118 | re-keyed from `20261002000118` |
| 20261002153000 | editorial_batch_metrics | 20261002000607 | re-keyed from `20261002000607` |
| 20261002154000 | class_owner_returning_policy | 20261002000919 | re-keyed from `20261002000919` |
| 20261002155000 | class_owner_tenant_boundary | 20261002001053 | re-keyed from `20261002001053` |
| 20261002160000 | content_pagination_bounds | 20261002001304 | re-keyed from `20261002001304` |
| 20261002161000 | assessment_snapshot_editorial_proof | 20261002001807 | re-keyed from `20261002001807` |
| 20261002162000 | rich_content_key_allowlist | 20261002002018 | re-keyed from `20261002002018` |
| 20261002163000 | editorial_contract_bounds | 20261002002510 | re-keyed from `20261002002510` |
| 20261002164000 | validator_json_aliases | 20261002002944 | re-keyed from `20261002002944` |
| 20261002170000 | production_readiness_security | 20261002004957 | re-keyed from `20261002004957` |
| 20261002171000 | coverage_targets_media | 20261002005256 | re-keyed from `20261002005256` |
| 20261002172000 | legacy_privilege_boundary | 20261002005449 | re-keyed from `20261002005449` |
| 20261002173000 | failed_operation_budget_boundary | 20261002064205 | re-keyed from `20261002064205` |
| 20261002174000 | final_review_pagination | 20261002064439 | re-keyed from `20261002064439` |
| 20261002175000 | media_registry_write_grants | 20261002065235 | re-keyed from `20261002065235` |
| 20261002200000 | market_sme_foundation | 20261002200000 | unchanged |
| 20261002210000 | content_market_enforcement | 20261002210000 | unchanged |
| 20261002220000 | sponsor_competition_lifecycle | 20261002220000 | unchanged |
| 20261002230000 | sponsor_authenticated_workflows | 20261002230000 | unchanged |
| 20261002240000 | sponsor_candidate_review_bridge | 20261002240000 | unchanged |
| 20261002250000 | sponsor_source_delivery | 20261002250000 | unchanged |
| 20261002260000 | legacy_node_attribution | 20261002260000 | unchanged |
| 20261002270000 | competition_review_operations | 20261002270000 | unchanged |
| 20261002280000 | hot_path_performance | 20261002280000 | unchanged |
| 20261003100000 | multi_market_platform | 20261003100000 | unchanged |
| 20261003110000 | country_first_signup | 20261003110000 | unchanged |
| 20261003120000 | market_grade_codes | 20261003120000 | unchanged |
| 20261003130000 | market_content_grades | 20261003130000 | unchanged |
| 20261003140000 | market_setup_curricula | 20261003140000 | unchanged |
| 20261003150000 | editorial_market_grades | 20261003150000 | unchanged |
| 20261003160000 | sme_queue_predicate_grant | 20261003160000 | unchanged |
| 20261003170000 | continuous_attribution | 20261003170000 | unchanged |
| 20261003180000 | sme_review_guard_alias | 20261003180000 | unchanged |
| 20261003190000 | class_policy_row_check | 20261003190000 | unchanged |
| 20261003200000 | self_serve_tenant_access | 20261003200000 | unchanged |
| 20261004100000 | activity_search_home | 20261004100000 | unchanged |
| 20261004110000 | quality_analytics_home | 20261004110000 | unchanged |
| 20261004120000 | competition_school_admin_ops | 20261004120000 | unchanged |
| 20261005100000 | content_factory | 20261005100000 | unchanged |
| 20261006100000 | curriculum_source_registry | 20261006100000 | unchanged |
| 20261006110000 | analytics_contracts_final | 20261006110000 | unchanged |
| 20261006120000 | analytics_contracts_security | 20261006120000 | unchanged |
| 20261007100000 | core_platform_foundation | absent | recorded (was absent) |
| 20261008100000 | school_performance | absent | recorded (was absent) |
| 20261009100000 | throttle_and_scoped_duplicates | absent | recorded (was absent) |
| 20261010100000 | admin_rpc_budget_order | absent | recorded (was absent) |
| 20261010110000 | auth_failure_hardening | absent | recorded (was absent) |

Changed rows: 31 (19 re-keyed to canonical versions, 12 newly recorded). No schema object was created, dropped or altered by the repair itself.
Newly recorded rows are physically present on Preview and verified by the schema fingerprint comparison (see docs/release/schema-parity-report.md); none is recorded without being applied.
