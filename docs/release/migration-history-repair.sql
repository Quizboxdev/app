-- PROPOSAL ONLY. NOT EXECUTED. Preview migration-history repair (see docs/release/migration-reconciliation-plan.md).
-- Run ONLY after the scratch-replay parity check (plan step 2) is clean and the owner has approved step 4. Preview only; never production.
-- Group D (20261008100000_school_performance) must be APPLIED first (psql -f supabase/migrations/20261008100000_school_performance.sql), then recorded below.
begin;
-- A. renumbered: replace the 19 old-stamp rows with the repo versions (same names)
delete from supabase_migrations.schema_migrations where version='20261001230902' and name='secure_practice_feedback';
delete from supabase_migrations.schema_migrations where version='20261001232209' and name='skip_zero_xp_award';
delete from supabase_migrations.schema_migrations where version='20261001234546' and name='question_factory_governance';
delete from supabase_migrations.schema_migrations where version='20261001235655' and name='question_factory_input_hardening';
delete from supabase_migrations.schema_migrations where version='20261002000118' and name='learning_rpc_context_hardening';
delete from supabase_migrations.schema_migrations where version='20261002000607' and name='editorial_batch_metrics';
delete from supabase_migrations.schema_migrations where version='20261002000919' and name='class_owner_returning_policy';
delete from supabase_migrations.schema_migrations where version='20261002001053' and name='class_owner_tenant_boundary';
delete from supabase_migrations.schema_migrations where version='20261002001304' and name='content_pagination_bounds';
delete from supabase_migrations.schema_migrations where version='20261002001807' and name='assessment_snapshot_editorial_proof';
delete from supabase_migrations.schema_migrations where version='20261002002018' and name='rich_content_key_allowlist';
delete from supabase_migrations.schema_migrations where version='20261002002510' and name='editorial_contract_bounds';
delete from supabase_migrations.schema_migrations where version='20261002002944' and name='validator_json_aliases';
delete from supabase_migrations.schema_migrations where version='20261002004957' and name='production_readiness_security';
delete from supabase_migrations.schema_migrations where version='20261002005256' and name='coverage_targets_media';
delete from supabase_migrations.schema_migrations where version='20261002005449' and name='legacy_privilege_boundary';
delete from supabase_migrations.schema_migrations where version='20261002064205' and name='failed_operation_budget_boundary';
delete from supabase_migrations.schema_migrations where version='20261002064439' and name='final_review_pagination';
delete from supabase_migrations.schema_migrations where version='20261002065235' and name='media_registry_write_grants';
insert into supabase_migrations.schema_migrations(version,name) values('20261002140000','secure_practice_feedback') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002141000','skip_zero_xp_award') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002150000','question_factory_governance') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002151000','question_factory_input_hardening') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002152000','learning_rpc_context_hardening') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002153000','editorial_batch_metrics') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002154000','class_owner_returning_policy') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002155000','class_owner_tenant_boundary') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002160000','content_pagination_bounds') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002161000','assessment_snapshot_editorial_proof') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002162000','rich_content_key_allowlist') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002163000','editorial_contract_bounds') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002164000','validator_json_aliases') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002170000','production_readiness_security') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002171000','coverage_targets_media') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002172000','legacy_privilege_boundary') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002173000','failed_operation_budget_boundary') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002174000','final_review_pagination') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002175000','media_registry_write_grants') on conflict (version) do nothing;
-- B, C, D (after applying it), E: record the repo versions
insert into supabase_migrations.schema_migrations(version,name) values('20261001160000','core_learning_engine') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261001180000','fix_curriculum_node_identity') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261001190000','canonical_curriculum_identity') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261001200000','grade_canonicalization') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261001210000','learning_loop_rpcs') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002120000','targeted_remediation_publish') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261002130000','fix_learning_loop_status_enum') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261007100000','core_platform_foundation') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261008100000','school_performance') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261009100000','throttle_and_scoped_duplicates') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261010100000','admin_rpc_budget_order') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations(version,name) values('20261010110000','auth_failure_hardening') on conflict (version) do nothing;
-- verify: must return 0 rows each
select 'in repo, not in history' k, version from (values ('20260926180457'),('20260926180522'),('20260926184037'),('20260926185133'),('20261001160000'),('20261001180000'),('20261001190000'),('20261001200000'),('20261001210000'),('20261002120000'),('20261002130000'),('20261002140000'),('20261002141000'),('20261002150000'),('20261002151000'),('20261002152000'),('20261002153000'),('20261002154000'),('20261002155000'),('20261002160000'),('20261002161000'),('20261002162000'),('20261002163000'),('20261002164000'),('20261002170000'),('20261002171000'),('20261002172000'),('20261002173000'),('20261002174000'),('20261002175000'),('20261002200000'),('20261002210000'),('20261002220000'),('20261002230000'),('20261002240000'),('20261002250000'),('20261002260000'),('20261002270000'),('20261002280000'),('20261003100000'),('20261003110000'),('20261003120000'),('20261003130000'),('20261003140000'),('20261003150000'),('20261003160000'),('20261003170000'),('20261003180000'),('20261003190000'),('20261003200000'),('20261004100000'),('20261004110000'),('20261004120000'),('20261005100000'),('20261006100000'),('20261006110000'),('20261006120000'),('20261007100000'),('20261008100000'),('20261009100000'),('20261010100000'),('20261010110000')) r(version) where version not in (select version from supabase_migrations.schema_migrations);
select 'in history, not in repo' k, version from supabase_migrations.schema_migrations where version not in ('20260926180457','20260926180522','20260926184037','20260926185133','20261001160000','20261001180000','20261001190000','20261001200000','20261001210000','20261002120000','20261002130000','20261002140000','20261002141000','20261002150000','20261002151000','20261002152000','20261002153000','20261002154000','20261002155000','20261002160000','20261002161000','20261002162000','20261002163000','20261002164000','20261002170000','20261002171000','20261002172000','20261002173000','20261002174000','20261002175000','20261002200000','20261002210000','20261002220000','20261002230000','20261002240000','20261002250000','20261002260000','20261002270000','20261002280000','20261003100000','20261003110000','20261003120000','20261003130000','20261003140000','20261003150000','20261003160000','20261003170000','20261003180000','20261003190000','20261003200000','20261004100000','20261004110000','20261004120000','20261005100000','20261006100000','20261006110000','20261006120000','20261007100000','20261008100000','20261009100000','20261010100000','20261010110000');
-- commit only if both verification queries returned no rows; otherwise rollback.
rollback; -- change to commit; after review
