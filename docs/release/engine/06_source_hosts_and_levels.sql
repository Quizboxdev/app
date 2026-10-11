-- READ-ONLY. The web hosts the 47 sources come from, and how they split by curriculum and level.
-- The hosts are what you enter as the authority's official publishing domains before anything can be fetched.
select split_part(split_part(r.canonical_url, '://', 2), '/', 1) as host,
  c.code as curriculum, r.education_level, r.status, count(*) as sources
from quizbox_sources.registry r join public.curricula c on c.id = r.curriculum_id
group by 1, 2, 3, 4
order by 1, 2, 3, 4;
