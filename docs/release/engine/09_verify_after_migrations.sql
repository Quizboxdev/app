-- READ-ONLY. One row. Expect functions = 14, tables_ok = true, pool_column = true, and the four pool limits.
select jsonb_build_object(
  'functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname in ('qb_topic_normalise', 'qb_topic_save', 'qb_topic_set_status', 'qb_topic_readiness',
                  'qb_curriculum_nodes_import', 'qb_question_load', 'qb_sme_pool', 'qb_sme_pick', 'qb_sme_release', 'qb_sme_pool_sweep',
                  'qb_sme_pool_settings', 'qb_teacher_topics', 'qb_topic_assignment_plan', 'qb_publish_topic_assignment')),
  'functions_expected', 14,
  'tables_ok', (to_regclass('public.curriculum_topics') is not null and to_regclass('public.topic_concepts') is not null
                and to_regclass('public.question_topic_links') is not null and to_regclass('public.question_load_batches') is not null
                and to_regclass('public.assignment_topics') is not null and to_regclass('quizbox_sme.pool_settings') is not null),
  'pool_column', exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sme_review_assignments' and column_name = 'picked_from_pool'),
  'pool_settings', (select jsonb_object_agg(key, value) from quizbox_sme.pool_settings)
) as engine_check;
