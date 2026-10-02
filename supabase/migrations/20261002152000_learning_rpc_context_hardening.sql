begin;
do $hardening$
declare body text; f record;
begin
 body:=pg_get_functiondef('public.qb_start_attempt(uuid,uuid,uuid,text)'::regprocedure);
 body:=replace(body,'begin', $fragment$begin
 if p_assessment_id is null or length(coalesce(p_client_session_id,''))>200 then raise exception 'QB_INVALID_ATTEMPT_INPUT'; end if;
 perform pg_advisory_xact_lock(hashtext('qb_attempt:'||auth.uid()::text||':'||p_assessment_id::text));
 if exists(select 1 from public.assignments where assessment_id=p_assessment_id) then
  if not exists(select 1 from public.assignments a where a.assessment_id=p_assessment_id and a.id=p_assignment_id and a.class_id=p_class_id and a.status='published') then raise exception 'QB_ASSIGNMENT_CONTEXT_MISMATCH'; end if;
 elsif p_assignment_id is not null or p_class_id is not null then raise exception 'QB_ASSIGNMENT_CONTEXT_MISMATCH'; end if;
$fragment$);
 execute body;
 body:=pg_get_functiondef('public.qb_get_questions(text,text,integer)'::regprocedure);
 body:=replace(body,'q.status = ''active''','q.status = ''active'' and auth.uid() is not null and public.qb_question_is_available(q)');
 execute body;
 body:=pg_get_functiondef('public.qb_question_availability(uuid[],text,text)'::regprocedure);
 body:=replace(body,'where q.curriculum_node_id', 'where auth.uid() is not null and upper(public.qb_current_role()) in (''TEACHER'',''ADMIN'',''OWNER'') and coalesce(cardinality(p_curriculum_node_ids),0) between 1 and 100 and public.qb_question_is_available(q) and q.curriculum_node_id');
 body:=replace(body,'or q.grade::text = p_grade','or coalesce(q.canonical_grade_code,q.grade::text) = case when p_grade=''B10'' then ''SHS1'' else p_grade end');
 execute body;
 alter function public.qb_question_availability(uuid[],text,text) security definer;
 body:=pg_get_functiondef('public.qb_content_queue(jsonb,integer,integer)'::regprocedure);
 body:=replace(body,'subject_code,grade,validation_status','subject_code,grade,canonical_grade_code,source_grade_code,validation_status');
 body:=replace(body,'q.grade::text=p_filters','coalesce(q.canonical_grade_code,q.grade::text)=p_filters');
 execute body;
 for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('qb_question_availability','qb_student_xp','qb_proficiency','qb_set_updated_at','qb_normalize_text','qb_grade_response') loop
  execute format('alter function %s set search_path=public,pg_temp',f.oid::regprocedure);
 end loop;
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname in ('qb_join_class','qb_list_available_assessments','qb_my_results','qb_get_questions','qb_question_availability','qb_student_xp') loop
  execute format('revoke all on function %s from public,anon',f.oid::regprocedure);
  execute format('grant execute on function %s to authenticated',f.oid::regprocedure);
 end loop;
end $hardening$;
notify pgrst,'reload schema';
commit;
