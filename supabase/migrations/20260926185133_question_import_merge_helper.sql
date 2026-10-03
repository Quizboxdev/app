create or replace function public.merge_quizbox_question_import(p_import_token text, p_subject_code text, p_grade text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  affected integer := 0;
begin
  with rows as (
    select
      payload,
      payload->>'source_code' as source_code,
      payload->>'external_question_id' as external_question_id,
      payload->>'question_code' as question_code,
      payload->>'batch_id' as batch_id,
      payload->>'learning_area_code' as learning_area_code,
      payload->>'learning_area_name' as learning_area_name,
      payload->>'subject_code' as subject_code,
      payload->>'subject_name' as subject_name,
      (payload->>'grade')::public.qb_grade as grade,
      payload->>'level_code' as level_code,
      payload->>'strand_no' as strand_no,
      payload->>'strand_name' as strand_name,
      payload->>'substrand_no' as substrand_no,
      payload->>'substrand_name' as substrand_name,
      payload->>'content_standard_code' as content_standard_code,
      payload->>'content_standard_text' as content_standard_text,
      payload->>'indicator_code' as indicator_code,
      payload->>'indicator_text' as indicator_text,
      payload->>'difficulty_code' as difficulty_code,
      payload->>'difficulty_label' as difficulty_label,
      payload->>'cognitive_level' as cognitive_level,
      payload->>'question_text' as question_text,
      payload->>'option_a' as option_a,
      payload->>'option_b' as option_b,
      payload->>'option_c' as option_c,
      payload->>'option_d' as option_d,
      payload->>'correct_answer' as correct_answer,
      payload->>'explanation' as explanation,
      coalesce(nullif(payload->>'marks','')::numeric, 1) as marks,
      nullif(payload->>'estimated_time_seconds','')::integer as estimated_time_seconds,
      case when jsonb_typeof(payload->'tags') = 'array' then array(select jsonb_array_elements_text(payload->'tags')) else array[]::text[] end as tags,
      payload->>'source_type' as source_type,
      payload->>'curriculum_reference' as curriculum_reference,
      payload->>'validation_status' as validation_status,
      payload->>'duplicate_group_id' as duplicate_group_id,
      payload->>'commercial_status' as commercial_status,
      payload->>'source_storage_path' as source_storage_path
    from public.quizbox_question_import_stage
    where import_token = p_import_token
      and payload->>'subject_code' = p_subject_code
      and payload->>'grade' = p_grade
  )
  insert into public.questions
    (source_id, external_question_id, question_code, batch_id, learning_area_code, learning_area_name,
     subject_code, subject_name, grade, level_code, strand_no, strand_name, substrand_no, substrand_name,
     content_standard_code, content_standard_text, indicator_code, indicator_text, difficulty_code,
     difficulty_label, cognitive_level, question_text, option_a, option_b, option_c, option_d,
     correct_answer, explanation, marks, estimated_time_seconds, tags, source_type, curriculum_reference,
     validation_status, duplicate_group_id, commercial_status, source_storage_path, imported_at, status)
  select
    qs.id, r.external_question_id, r.question_code, r.batch_id, r.learning_area_code, r.learning_area_name,
    r.subject_code, r.subject_name, r.grade, r.level_code, r.strand_no, r.strand_name, r.substrand_no, r.substrand_name,
    r.content_standard_code, r.content_standard_text, r.indicator_code, r.indicator_text, r.difficulty_code,
    r.difficulty_label, r.cognitive_level, r.question_text, r.option_a, r.option_b, r.option_c, r.option_d,
    r.correct_answer, r.explanation, r.marks, r.estimated_time_seconds, r.tags, r.source_type, r.curriculum_reference,
    r.validation_status, r.duplicate_group_id, r.commercial_status, r.source_storage_path, now(), 'active'::public.qb_status
  from rows r
  left join public.question_sources qs on qs.source_code = r.source_code
  on conflict (external_question_id) do update set
    source_id = excluded.source_id,
    question_code = excluded.question_code,
    batch_id = excluded.batch_id,
    learning_area_code = excluded.learning_area_code,
    learning_area_name = excluded.learning_area_name,
    subject_code = excluded.subject_code,
    subject_name = excluded.subject_name,
    grade = excluded.grade,
    level_code = excluded.level_code,
    strand_no = excluded.strand_no,
    strand_name = excluded.strand_name,
    substrand_no = excluded.substrand_no,
    substrand_name = excluded.substrand_name,
    content_standard_code = excluded.content_standard_code,
    content_standard_text = excluded.content_standard_text,
    indicator_code = excluded.indicator_code,
    indicator_text = excluded.indicator_text,
    difficulty_code = excluded.difficulty_code,
    difficulty_label = excluded.difficulty_label,
    cognitive_level = excluded.cognitive_level,
    question_text = excluded.question_text,
    option_a = excluded.option_a,
    option_b = excluded.option_b,
    option_c = excluded.option_c,
    option_d = excluded.option_d,
    correct_answer = excluded.correct_answer,
    explanation = excluded.explanation,
    marks = excluded.marks,
    estimated_time_seconds = excluded.estimated_time_seconds,
    tags = excluded.tags,
    source_type = excluded.source_type,
    curriculum_reference = excluded.curriculum_reference,
    validation_status = excluded.validation_status,
    duplicate_group_id = excluded.duplicate_group_id,
    commercial_status = excluded.commercial_status,
    source_storage_path = excluded.source_storage_path,
    imported_at = excluded.imported_at,
    status = excluded.status,
    updated_at = now();

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.merge_quizbox_question_import(text, text, text) from public;
revoke all on function public.merge_quizbox_question_import(text, text, text) from anon;
revoke all on function public.merge_quizbox_question_import(text, text, text) from authenticated;