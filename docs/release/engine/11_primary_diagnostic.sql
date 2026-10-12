-- READ ONLY. What each curriculum actually holds, by education level, and whether the Primary curriculum (GH-SBC-2019) carries
-- the JHS structure. Expected for a clean Primary curriculum: only education_level 'Primary' (1 level + 3 grades + 30 subjects = 34 nodes).
with per as (
  select c.code, coalesce(n.education_level, '(none)') as education_level,
         count(*) as nodes,
         count(*) filter (where n.node_type = 'learning_indicator') as indicators,
         count(*) filter (where n.node_type = 'learning_indicator' and n.is_active) as active_indicators
  from public.curricula c
  join public.curriculum_nodes n on n.curriculum_id = c.id
  where c.code in ('GH-CCP-JHS', 'GH-SBC-2019', 'GH-CCP-2020', 'GH-SOURCE')
  group by c.code, n.education_level
)
select * from per order by code, education_level;
