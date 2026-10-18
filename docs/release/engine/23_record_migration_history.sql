-- Record the 26 hand-applied migrations in production's migration history (tracker C3). Objects were verified against the repository on 18 October 2026.
-- Adds history rows only; changes no data and no schema. Safe to run twice.
insert into supabase_migrations.schema_migrations(version, name)
values
  ('20261007100000','core_platform_foundation'),
  ('20261008100000','school_performance'),
  ('20261009100000','throttle_and_scoped_duplicates'),
  ('20261010100000','admin_rpc_budget_order'),
  ('20261010110000','auth_failure_hardening'),
  ('20261011100000','ghana_market_configuration'),
  ('20261011110000','ghana_primary_curriculum'),
  ('20261011120000','admin_content_views_exclude_archived'),
  ('20261012100000','topic_registry'),
  ('20261012110000','curriculum_structure_import'),
  ('20261012120000','question_load'),
  ('20261012130000','sme_pool'),
  ('20261012140000','topic_assignment'),
  ('20261012150000','source_file_claim'),
  ('20261012160000','source_file_release'),
  ('20261012170000','structure_import_level_guard'),
  ('20261012180000','reviewer_support_and_catalogue'),
  ('20261012190000','public_platform_stats'),
  ('20261012200000','quick_practice'),
  ('20261012210000','practice_for_staff'),
  ('20261014100000','free_allowance_gate'),
  ('20261014110000','owner_batch_approval'),
  ('20261018100000','access_gate_standalone'),
  ('20261018110000','readable_topic_labels'),
  ('20261018120000','grant_hardening_table_maintenance'),
  ('20261018130000','staff_practice_preview')
on conflict (version) do nothing;

select version, name from supabase_migrations.schema_migrations where version >= '20261007100000' order by version;
