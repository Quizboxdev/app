-- READ-ONLY. One row per curriculum: how much structure it has, which grades, how many classes and live questions depend on it,
-- and how many approved sources. Use it to decide where the JHS and SHS structure should be loaded.
select c.code, c.name, c.version,
  (select count(*) from public.curriculum_nodes n where n.curriculum_id = c.id) as all_nodes,
  (select count(*) from public.curriculum_nodes n where n.curriculum_id = c.id and n.node_type = 'learning_indicator') as indicators,
  (select string_agg(distinct coalesce(n.canonical_grade_code, n.grade_code), ',' order by coalesce(n.canonical_grade_code, n.grade_code))
     from public.curriculum_nodes n where n.curriculum_id = c.id and n.node_type = 'learning_indicator') as indicator_grades,
  (select count(*) from public.classes k where k.curriculum_id = c.id) as classes,
  (select count(*) from public.questions q where q.curriculum_id = c.id and q.status::text = 'active' and q.validation_status = 'approved') as live_questions,
  (select count(*) from public.source_documents d where d.curriculum_id = c.id and d.validation_status = 'approved' and d.rights_confirmed) as approved_sources
from public.curricula c
order by c.code;
