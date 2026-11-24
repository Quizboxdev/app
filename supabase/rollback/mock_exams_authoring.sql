-- Rollback for 20261122100000_mock_exams_authoring.sql: removes every authoring function, so nothing can be built, picked or published.
-- The tables (exams, rounds, chosen questions, published versions) and the settings are KEPT on purpose: published versions are the record of what students were examined on.
-- Run the rollbacks of the delivery and marketplace migrations first (they use these tables). To remove the records as well (only before any student has taken an exam), drop the mock_exam* tables by hand.
begin;
do $$ declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('qb_mock_enabled', 'qb_mock_author_status', 'qb_mock_curricula', 'qb_mock_grades', 'qb_mock_subjects',
      'qb_mock_topics', 'qb_mock_exam_create', 'qb_mock_exam_update', 'qb_mock_exam_list', 'qb_mock_exam_get', 'qb_mock_exam_delete', 'qb_mock_exam_archive', 'qb_mock_round_save', 'qb_mock_round_delete', 'qb_mock_round_pick',
      'qb_mock_round_clear', 'qb_mock_round_candidates', 'qb_mock_round_set_questions', 'qb_mock_exam_review', 'qb_mock_exam_publish') loop
    execute 'drop function if exists ' || f.sig;
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'quizbox_mock'::regnamespace and p.proname in ('num', 'canon', 'grade_rank', 'stage', 'eligible', 'author_kind', 'curriculum_ok', 'own_exam', 'dup_key', 'taken',
      'subject_label', 'rounds_json', 'totals', 'exam_json', 'readiness') loop
    execute 'drop function if exists ' || f.sig;
  end loop;
end $$;
commit;
notify pgrst, 'reload schema';
