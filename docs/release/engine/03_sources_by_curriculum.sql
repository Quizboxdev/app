-- READ-ONLY. Which curriculum each registered source (the 47) is attached to, and how far it has got.
-- If this errors with "relation quizbox_sources.registry does not exist", migration 20261006100000 is not applied: that is the answer.
select c.code as curriculum, r.education_level, r.status, count(*) as sources
from quizbox_sources.registry r join public.curricula c on c.id = r.curriculum_id
group by 1, 2, 3 order by 1, 2, 3;
