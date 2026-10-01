begin;

alter table public.curriculum_nodes add column if not exists source_grade_code text;
alter table public.curriculum_nodes add column if not exists canonical_grade_code text;
alter table public.questions add column if not exists source_grade_code text;
alter table public.questions add column if not exists canonical_grade_code text;

update public.curriculum_nodes
set
  source_grade_code = coalesce(source_grade_code, case when code like 'B10.%' or code = 'GRADE:B10' or code like 'SUBJECT:B10:%' then 'B10' else grade_code end),
  canonical_grade_code = case when coalesce(source_grade_code, grade_code) = 'B10' then 'SHS1' else coalesce(canonical_grade_code, grade_code) end,
  grade_code = case when coalesce(source_grade_code, grade_code) = 'B10' then 'SHS1' else grade_code end,
  education_level = case when coalesce(source_grade_code, grade_code) = 'B10' then 'SHS' else education_level end,
  code = case
    when code = 'GRADE:B10' then 'GRADE:SHS1'
    when code like 'SUBJECT:B10:%' then regexp_replace(code, '^SUBJECT:B10:', 'SUBJECT:SHS1:')
    else code
  end;

update public.curriculum_nodes
set identity_key = concat_ws('|',
  coalesce(nullif(education_level, ''), 'GLOBAL'),
  coalesce(nullif(canonical_grade_code, ''), coalesce(nullif(grade_code, ''), 'GLOBAL')),
  coalesce(nullif(subject_code, ''), 'GLOBAL'),
  node_type,
  code
);

update public.questions
set
  source_grade_code = coalesce(source_grade_code, grade),
  canonical_grade_code = case when coalesce(source_grade_code, grade) = 'B10' then 'SHS1' else coalesce(canonical_grade_code, grade) end;

commit;
