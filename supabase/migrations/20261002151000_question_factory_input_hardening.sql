begin;
-- Restore only the answer-free metadata used by teacher selection and admin coverage.
grant select(id,question_code,question_text,grade,subject_code,strand_name,substrand_name,content_standard_code,indicator_code,difficulty_label,answer_type,status,source_type,created_at,curriculum_node_id,validation_status,duplicate_group_id,canonical_grade_code,source_grade_code,option_a,option_b,option_c,option_d) on public.questions to authenticated;
revoke insert,update,delete on public.questions from authenticated,anon;
do $hardening$
declare body text;
begin
 body:=pg_get_functiondef('public.qb_content_validation_errors(jsonb)'::regprocedure);
 body:=replace(body,'if jsonb_typeof(p)<>''object''','if jsonb_typeof(p) is distinct from ''object''');
 body:=replace(body,' return errors;', $fragment$
 if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p#>'{question_content,blocks}')='array' then p#>'{question_content,blocks}' else '[]'::jsonb end) b where
 (b->>'type'='text' and (jsonb_typeof(b->'text') is distinct from 'string' or b->>'text' ~* '<[^>]*>|javascript:|data:')) or
 (b->>'type'='math' and (jsonb_typeof(b->'latex') is distinct from 'string' or b->>'latex' ~* '\\(href|html|includegraphics)'))) then errors:=errors||'"UNSAFE_CONTENT"'::jsonb; end if;
 return errors;$fragment$);
 execute body;
 body:=pg_get_functiondef('public.qb_content_request_generation(jsonb)'::regprocedure);
 body:=replace(body,' select * into n', $fragment$
 if jsonb_typeof(p_spec) is distinct from 'object' or jsonb_typeof(p_spec->'count') is distinct from 'number' or p_spec->>'count' !~ '^[0-9]+$'
 or coalesce(p_spec->>'difficulty','') not in ('easy','medium','hard') or coalesce(p_spec->>'answerType','') not in ('SINGLE_CHOICE','TRUE_FALSE')
 or nullif(trim(p_spec->>'cognitiveLevel'),'') is null or nullif(trim(p_spec->>'language'),'') is null or nullif(trim(p_spec->>'educationLevel'),'') is null
 or coalesce((p_spec->>'marks')::numeric,0) not between 0.01 and 100 or coalesce((p_spec->>'expectedSeconds')::integer,0) not between 5 and 3600
 then raise exception 'QB_INVALID_GENERATION_SPEC'; end if;
 select * into n$fragment$);
 body:=replace(body,' perform pg_advisory_xact_lock', $fragment$
 if n.subject_code is distinct from p_spec->>'subject' or coalesce(n.canonical_grade_code,n.grade_code) is distinct from p_spec->>'grade' or n.title is distinct from p_spec->>'indicatorTitle' then raise exception 'QB_INVALID_GENERATION_SPEC'; end if;
 perform pg_advisory_xact_lock$fragment$);
 execute body;
 body:=pg_get_functiondef('public.qb_content_coverage(jsonb,integer,integer,integer)'::regprocedure);
 body:=replace(body,'n.grade_code,n.subject_code,','n.grade_code,n.canonical_grade_code,n.source_grade_code,n.education_level,n.subject_code,');
 body:=replace(body,'r.grade_code=p_filters','coalesce(r.canonical_grade_code,r.grade_code)=p_filters');
 execute body;
 body:=pg_get_functiondef('public.qb_content_review(uuid,text,integer,text,jsonb,text,boolean)'::regprocedure);
 body:=replace(body,'report=report||jsonb_build_object(''last_event'',jsonb_build_object(''event'',''content.''||p_action,''question_id'',q.id,''actor_id'',auth.uid(),''at'',now()))',
 $fragment$report=report||jsonb_build_object('last_event',jsonb_build_object('event','content.'||p_action,'question_id',q.id,'actor_id',auth.uid(),'at',now()),'events',coalesce(report->'events','[]'::jsonb)||jsonb_build_array(jsonb_build_object('event','content.'||p_action,'question_id',q.id,'actor_id',auth.uid(),'at',now())))$fragment$);
 execute body;
end $hardening$;
notify pgrst,'reload schema';
commit;
