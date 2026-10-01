begin;

update public.curriculum_nodes
set identity_key = concat_ws('|',
  coalesce(nullif(education_level, ''), 'GLOBAL'),
  coalesce(nullif(grade_code, ''), 'GLOBAL'),
  coalesce(nullif(subject_code, ''), 'GLOBAL'),
  node_type,
  code
);

commit;
