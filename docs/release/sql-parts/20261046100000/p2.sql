create or replace function public.qb_export_defs_b() returns table(key text, label text, grp text, date_label text, category_label text, categories text[], need text, tbl text, descr text)
language sql immutable set search_path = '' as $fn$
  select * from (values
    ('interschool_competitions'::text, 'Interschool competitions'::text, 'Competitions'::text, 'Created'::text, 'Status (exact name, for example DRAFT)'::text, null::text[], 'competitions'::text, 'public.competitions'::text, 'Each interschool competition with dates, entry fee, prize pool, teams and sponsor.'::text),
    ('competition_results', 'Competition results', 'Competitions', 'Calculated', 'Result status (exact name)', null::text[], 'competitions', 'public.competition_results', 'Scores, ranks and times. Teams and learners appear as an anonymous code.'),
    ('sponsors', 'Sponsors', 'Competitions', 'Registered', 'Verification (exact name, for example PENDING)', null::text[], 'admin', 'public.sponsor_profiles', 'Sponsor organisations, contacts and verification.'),
    ('classes', 'Classes', 'Schools and learning', 'Created', 'Grade (for example B7)', null::text[], 'admin', 'public.classes', 'Classes with school, grade, term, learner count and teacher. Join codes are not exported.'),
    ('class_results', 'Class results', 'Schools and learning', 'Graded', 'Subject (exact name)', null::text[], 'admin', 'public.gradebook', 'Graded assignment results with score and percentage. Learners appear as an anonymous code.'),
    ('assignments', 'Assignments', 'Schools and learning', 'Created', 'Status', array['draft', 'published', 'closed']::text[], 'admin', 'public.assignments', 'Assignments with subject, grade, due date and status.'),
    ('notifications', 'Notifications sent', 'Schools and learning', 'Sent', 'Type (exact name)', null::text[], 'admin', 'public.notifications', 'How many notifications were sent, of what type, and whether they were read. No message text.'),
    ('teachers', 'Teachers', 'People and audit', 'Joined', 'Status', array['active', 'inactive', 'archived']::text[], 'owner', 'public.teacher_profiles', 'Teachers with school, region, classes and learner counts.'),
    ('learners', 'Learners', 'People and audit', 'Joined', 'Grade (for example B7)', null::text[], 'owner', 'public.student_profiles', 'Learner accounts by grade, school and region. Teacher-managed children are left out.')
  ) as v(key, label, grp, date_label, category_label, categories, need, tbl, descr);
$fn$;

create or replace function public.qb_export_defs() returns table(key text, label text, grp text, date_label text, category_label text, categories text[], need text, tbl text, descr text)
language sql immutable set search_path = '' as $fn$
  select * from public.qb_export_defs_a() union all select * from public.qb_export_defs_b();
$fn$;

create or replace function public.qb_export_build_f(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_cols text[]; v_rows jsonb; v_total bigint;
begin
  case p_dataset
  when 'interschool_competitions' then
    v_cols := array['Created (UTC)', 'Title', 'Type', 'Subject', 'Grade', 'Status', 'Starts (UTC)', 'Ends (UTC)', 'Entry fee', 'Prize pool', 'Currency', 'Participant limit', 'Teams', 'Sponsor'];
    with f as (select c.created_at as k, jsonb_build_array(public.qb_export_ts(c.created_at), c.title, c.competition_type, c.subject_code, c.grade, c.status, public.qb_export_ts(c.starts_at), public.qb_export_ts(c.ends_at), c.entry_fee, c.prize_pool, c.currency, c.participant_limit,
        (select count(*) from public.competition_teams t where t.competition_id = c.id), sp.organization_name) as r
      from public.competitions c left join public.sponsor_profiles sp on sp.id = c.sponsor_id
      where (p_from is null or c.created_at >= p_from) and (p_to is null or c.created_at < p_to) and (p_category is null or c.status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'competition_results' then
    v_cols := array['Calculated (UTC)', 'Competition', 'Entity type', 'Entity code', 'Score', 'Percent', 'Seconds taken', 'Rank', 'Status'];
    with f as (select r0.calculated_at as k, jsonb_build_array(public.qb_export_ts(r0.calculated_at), c.title, r0.entity_type, left(md5(r0.entity_id::text), 10), r0.score, r0.percentage, round(r0.completion_time_ms / 1000.0, 1), r0.rank, r0.result_status) as r
      from public.competition_results r0 left join public.competitions c on c.id = r0.competition_id
      where (p_from is null or r0.calculated_at >= p_from) and (p_to is null or r0.calculated_at < p_to) and (p_category is null or r0.result_status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'sponsors' then
    v_cols := array['Registered (UTC)', 'Organisation', 'Type', 'Contact', 'Email', 'Country', 'Verification', 'Status'];
    with f as (select s.created_at as k, jsonb_build_array(public.qb_export_ts(s.created_at), s.organization_name, s.sponsor_type, s.contact_name, u.email, s.country, s.verification_status, s.status) as r
      from public.sponsor_profiles s left join public.profiles u on u.id = s.user_id
      where (p_from is null or s.created_at >= p_from) and (p_to is null or s.created_at < p_to) and (p_category is null or s.verification_status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  else return null;
  end case;
  return jsonb_build_object('columns', to_jsonb(v_cols), 'rows', v_rows, 'total', v_total, 'truncated', v_total > jsonb_array_length(v_rows));
end $fn$;
