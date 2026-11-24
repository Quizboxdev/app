-- Rollback for 20261122110000_mock_exams_delivery.sql: removes the class-assignment, results and export functions.
-- The tables (assignment links, enrolments) are KEPT on purpose: they record which version each class and buyer took. Classes' assignments themselves are ordinary assignments and are not touched.
begin;
do $$ declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('qb_mock_exam_health', 'qb_mock_class_options', 'qb_mock_assign_class', 'qb_mock_exam_assignments',
      'qb_mock_results', 'qb_mock_result_rows', 'qb_mock_export') loop
    execute 'drop function if exists ' || f.sig;
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'quizbox_mock'::regnamespace and p.proname in ('stale', 'option_text', 'answer_text', 'correct_text', 'attempt_rows', 'result_rows') loop
    execute 'drop function if exists ' || f.sig;
  end loop;
end $$;
commit;
notify pgrst, 'reload schema';
