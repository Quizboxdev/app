-- Hot-path performance only: student assessment lookup, teacher overview, SME queue,
-- sponsor workspace, official results, leaderboard and analytics. No data or semantics change.
begin;

-- Foreign keys these flows filter or join on (Performance Advisor: unindexed_foreign_keys).
create index if not exists assignments_assessment_id_idx on public.assignments(assessment_id);
create index if not exists assignment_targets_class_id_idx on public.assignment_targets(class_id);
create index if not exists attempts_student_id_idx on public.attempts(student_id);
create index if not exists attempts_assignment_id_idx on public.attempts(assignment_id);
create index if not exists assessment_results_student_user_id_idx on public.assessment_results(student_user_id);
create index if not exists assessment_results_assignment_id_idx on public.assessment_results(assignment_id);
create index if not exists assessments_competition_snapshot_id_idx on public.assessments(competition_snapshot_id);
create index if not exists gradebook_student_user_id_idx on public.gradebook(student_user_id);
create index if not exists gradebook_assignment_id_idx on public.gradebook(assignment_id);
create index if not exists learning_events_attempt_id_idx on public.learning_events(attempt_id);
create index if not exists learning_events_curriculum_node_id_idx on public.learning_events(curriculum_node_id);
create index if not exists mastery_records_curriculum_node_id_idx on public.mastery_records(curriculum_node_id);
create index if not exists questions_curriculum_node_id_idx on public.questions(curriculum_node_id);
create index if not exists responses_question_id_idx on public.responses(question_id);
create index if not exists legacy_content_attributions_curriculum_id_idx on public.legacy_content_attributions(curriculum_id);
create index if not exists sme_review_assignments_domain_assignment_id_idx on public.sme_review_assignments(domain_assignment_id);
create index if not exists sme_review_events_candidate_id_idx on public.sme_review_events(candidate_id);
create index if not exists candidates_question_id_idx on quizbox_competition.candidates(question_id);
create index if not exists candidates_job_competition_idx on quizbox_competition.candidates(job_id,competition_id);
create index if not exists candidates_document_competition_idx on quizbox_competition.candidates(source_document_id,competition_id);
create index if not exists candidates_primary_assignment_id_idx on quizbox_competition.candidates(primary_assignment_id);
create index if not exists documents_competition_id_idx on quizbox_competition.documents(competition_id);
create index if not exists official_results_competition_id_idx on quizbox_competition.official_results(competition_id);
create index if not exists official_results_participant_id_idx on quizbox_competition.official_results(participant_id);
create index if not exists leaderboard_result_id_idx on quizbox_competition.leaderboard(result_id);
create index if not exists registrations_participant_id_idx on quizbox_competition.registrations(participant_id);
create index if not exists review_events_candidate_id_idx on quizbox_competition.review_events(candidate_id);
create index if not exists snapshots_assessment_id_idx on quizbox_competition.snapshots(assessment_id);
create index if not exists participations_participant_id_idx on quizbox_competition.participations(participant_id);
create index if not exists bank_items_candidate_competition_idx on quizbox_competition.bank_items(candidate_id,competition_id);

-- Identical duplicate of the responses (attempt_id,question_id) unique constraint index.
do $$ begin
 if to_regclass('public.responses_attempt_question_unique_idx') is not null
  and not exists(select 1 from pg_constraint where conindid='public.responses_attempt_question_unique_idx'::regclass)
  and exists(select 1 from pg_constraint where conname='responses_attempt_id_question_id_key' and conrelid='public.responses'::regclass) then
  drop index public.responses_attempt_question_unique_idx;
 end if;
end $$;

-- Evaluate auth.uid() once per statement instead of per row (auth_rls_initplan) in the
-- high-traffic owner-read policies. Expressions are otherwise unchanged.
do $$ declare p record; q text; w text; begin
 for p in select schemaname,tablename,policyname,qual,with_check from pg_policies where schemaname='public' and policyname in
  ('attempts_student_read','assessment_results_owner_read','responses_student_safe_read','gradebook_student_read','gradebook_teacher_read',
   'learning_events_owner_read','mastery_owner_read','assignments_student_target_read','assignments_teacher_owner','user_markets_read') loop
  q:=case when p.qual is not null and position('SELECT auth.uid()' in p.qual)=0 then replace(p.qual,'auth.uid()','( SELECT auth.uid() AS uid)') end;
  w:=case when p.with_check is not null and position('SELECT auth.uid()' in p.with_check)=0 then replace(p.with_check,'auth.uid()','( SELECT auth.uid() AS uid)') end;
  if q is not null then execute format('alter policy %I on %I.%I using (%s)',p.policyname,p.schemaname,p.tablename,q); end if;
  if w is not null then execute format('alter policy %I on %I.%I with check (%s)',p.policyname,p.schemaname,p.tablename,w); end if;
 end loop;
end $$;

-- Teacher overview: indicator aggregates computed in the database under the caller's own RLS
-- (SECURITY INVOKER), replacing the client-side download of every learning event.
-- Semantics match lib/learning/analytics.ts summarizeIndicators over the same event rows.
create function public.qb_teacher_indicator_summary(p_class_ids uuid[]) returns table(code text,title text,class_id uuid,curriculum_node_id uuid,
 learner_count integer,attempt_count integer,average_mastery numeric,average_accuracy numeric,proficiency_state text)
language sql stable security invoker set search_path='' as $$
 select coalesce(n.code,'unknown'),coalesce(max(n.title),coalesce(n.code,'unknown')),(array_agg(e.class_id))[1],(array_agg(e.curriculum_node_id))[1],
  count(distinct e.student_user_id)::integer,count(*)::integer,
  coalesce(round(avg(m.mastery_score)::numeric,2),0),
  coalesce(round(avg(case when e.is_correct then 100 when e.is_correct is not null then 0 end)::numeric,2),0),
  (array_agg(m.proficiency_state) filter (where m.proficiency_state is not null))[1]
 from public.learning_events e
 left join public.curriculum_nodes n on n.id=e.curriculum_node_id
 left join public.mastery_records m on m.curriculum_node_id=e.curriculum_node_id and m.student_user_id=e.student_user_id
 where e.class_id=any(p_class_ids) and cardinality(p_class_ids) between 1 and 200
 group by coalesce(n.code,'unknown');
$$;
revoke all on function public.qb_teacher_indicator_summary(uuid[]) from public,anon;
grant execute on function public.qb_teacher_indicator_summary(uuid[]) to authenticated;

commit;
