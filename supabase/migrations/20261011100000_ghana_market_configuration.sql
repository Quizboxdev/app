-- Ghana market onboarding catalogue. Production's Ghana market was activated with an empty configuration, so qb_signup_markets()
-- offered GH with no education levels, grades or subjects and no learner/teacher could finish onboarding.
-- Data only and idempotent: fills education_levels / grades / subjects only where they are missing or empty, keeps every other key
-- (e.g. an existing grade_policy), and touches only real (non-test) Ghana markets.
begin;

update public.markets m
set configuration = coalesce(m.configuration, '{}'::jsonb)
  || case when jsonb_array_length(coalesce(m.configuration->'education_levels', '[]')) = 0 then jsonb_build_object('education_levels', jsonb_build_array(
       jsonb_build_object('code', 'PRIMARY', 'label', 'Primary'),
       jsonb_build_object('code', 'JHS', 'label', 'Junior High School'),
       jsonb_build_object('code', 'SHS', 'label', 'Senior High School'))) else '{}'::jsonb end
  || case when jsonb_array_length(coalesce(m.configuration->'grades', '[]')) = 0 then jsonb_build_object('grades', jsonb_build_array(
       jsonb_build_object('code', 'B4', 'label', 'Class 4', 'level', 'PRIMARY'),
       jsonb_build_object('code', 'B5', 'label', 'Class 5', 'level', 'PRIMARY'),
       jsonb_build_object('code', 'B6', 'label', 'Class 6', 'level', 'PRIMARY'),
       jsonb_build_object('code', 'B7', 'label', 'Basic 7 (JHS 1)', 'level', 'JHS'),
       jsonb_build_object('code', 'B8', 'label', 'Basic 8 (JHS 2)', 'level', 'JHS'),
       jsonb_build_object('code', 'B9', 'label', 'Basic 9 (JHS 3)', 'level', 'JHS'),
       jsonb_build_object('code', 'SHS1', 'label', 'SHS 1 (Basic 10)', 'level', 'SHS'),
       jsonb_build_object('code', 'SHS2', 'label', 'SHS 2', 'level', 'SHS'),
       jsonb_build_object('code', 'SHS3', 'label', 'SHS 3', 'level', 'SHS'))) else '{}'::jsonb end
  || case when jsonb_array_length(coalesce(m.configuration->'subjects', '[]')) = 0 then jsonb_build_object('subjects', jsonb_build_array(
       jsonb_build_object('code', 'Mathematics', 'label', 'Mathematics'),
       jsonb_build_object('code', 'Science', 'label', 'Science'),
       jsonb_build_object('code', 'Computing', 'label', 'Computing'),
       jsonb_build_object('code', 'Social Studies', 'label', 'Social Studies'),
       jsonb_build_object('code', 'FRENCH', 'label', 'French'),
       jsonb_build_object('code', 'ARABIC', 'label', 'Arabic'),
       jsonb_build_object('code', 'Religious and Moral Education', 'label', 'Religious and Moral Education'))) else '{}'::jsonb end
  || case when m.configuration ? 'grade_policy' then '{}'::jsonb else jsonb_build_object('grade_policy', jsonb_build_object('self_practice', 'STRICT_GRADE')) end
from public.countries c
where c.id = m.country_id and c.iso2_code = 'GH' and not m.is_test
  and (jsonb_array_length(coalesce(m.configuration->'education_levels', '[]')) = 0
    or jsonb_array_length(coalesce(m.configuration->'grades', '[]')) = 0
    or jsonb_array_length(coalesce(m.configuration->'subjects', '[]')) = 0
    or not (m.configuration ? 'grade_policy'));

do $check$
begin
  if exists (select 1 from public.markets m join public.countries c on c.id = m.country_id
             where c.iso2_code = 'GH' and not m.is_test and m.status = 'ACTIVE' and jsonb_array_length(coalesce(m.configuration->'grades', '[]')) = 0) then
    raise exception 'GHANA_MARKET_CONFIGURATION_INCOMPLETE';
  end if;
end $check$;

commit;
