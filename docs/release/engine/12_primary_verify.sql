-- READ ONLY. Primary (B4-B6) readiness after the structure load (decision D-18).
-- Expected after loading Primary_indicators_reconciled.csv into GH-SBC-2019:
--   GH-SBC-2019: education_level 1, grade 3, subject 36 (30 skeleton + History and Physical Education x 3), strand 112, sub_strand 278,
--                content_standard 524, learning_indicator 1012, and no node of any other education level.
--   GH-CCP-JHS and GH-CCP-2020: no 'Primary' node.
select c.code, coalesce(n.education_level, '(none)') as education_level, n.node_type, count(*) as nodes
from public.curricula c join public.curriculum_nodes n on n.curriculum_id = c.id
where c.code in ('GH-SBC-2019', 'GH-CCP-JHS', 'GH-CCP-2020')
  and (c.code = 'GH-SBC-2019' or n.education_level = 'Primary')
group by c.code, n.education_level, n.node_type
order by c.code, case n.node_type when 'education_level' then 0 when 'grade' then 1 when 'subject' then 2 when 'strand' then 3 when 'sub_strand' then 4 when 'content_standard' then 5 else 6 end;
