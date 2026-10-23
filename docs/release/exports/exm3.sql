create or replace function public.qb_export_build_g(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_cols text[]; v_rows jsonb; v_total bigint;
begin
  case p_dataset
  when 'classes' then
    v_cols := array['Created (UTC)', 'Class', 'School', 'Grade', 'Term', 'Academic year', 'Status', 'Active learners', 'Teacher email'];
    with f as (select c.created_at as k, jsonb_build_array(public.qb_export_ts(c.created_at), c.class_name, c.school_name, c.grade::text, c.term, c.academic_year, lower(c.status::text),
        (select count(*) from public.class_memberships m where m.class_id = c.id and lower(m.status::text) = 'active'), u.email) as r
      from public.classes c left join public.profiles u on u.id = c.teacher_user_id
      where (p_from is null or c.created_at >= p_from) and (p_to is null or c.created_at < p_to) and (p_category is null or c.grade::text = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'class_results' then
    v_cols := array['Graded (UTC)', 'Class', 'School', 'Assignment', 'Subject', 'Grade', 'Learner code', 'Score', 'Out of', 'Percent', 'Status'];
    with f as (select g.graded_at as k, jsonb_build_array(public.qb_export_ts(g.graded_at), c.class_name, c.school_name, a.title, a.subject_name, a.grade::text, left(md5(g.student_user_id::text), 10), g.score, g.total_marks, g.percentage, g.status) as r
      from public.gradebook g left join public.classes c on c.id = g.class_id left join public.assignments a on a.id = g.assignment_id
      where (p_from is null or g.graded_at >= p_from) and (p_to is null or g.graded_at < p_to) and (p_category is null or a.subject_name = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'assignments' then
    v_cols := array['Created (UTC)', 'Title', 'Subject', 'Grade', 'Class', 'Questions', 'Due (UTC)', 'Status', 'Published (UTC)', 'Teacher email'];
    with f as (select a.created_at as k, jsonb_build_array(public.qb_export_ts(a.created_at), a.title, a.subject_name, a.grade::text, c.class_name, a.question_count, public.qb_export_ts(a.due_at), a.status::text, public.qb_export_ts(a.published_at), u.email) as r
      from public.assignments a left join public.classes c on c.id = a.class_id left join public.profiles u on u.id = a.teacher_user_id
      where (p_from is null or a.created_at >= p_from) and (p_to is null or a.created_at < p_to) and (p_category is null or a.status::text = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'notifications' then
    v_cols := array['Sent (UTC)', 'Type', 'Title', 'Recipient role', 'Read', 'Read (UTC)'];
    with f as (select n.created_at as k, jsonb_build_array(public.qb_export_ts(n.created_at), n.type, left(n.title, 120), lower(n.recipient_role::text), n.read_at is not null, public.qb_export_ts(n.read_at)) as r
      from public.notifications n
      where (p_from is null or n.created_at >= p_from) and (p_to is null or n.created_at < p_to) and (p_category is null or n.type = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  else return null;
  end case;
  return jsonb_build_object('columns', to_jsonb(v_cols), 'rows', v_rows, 'total', v_total, 'truncated', v_total > jsonb_array_length(v_rows));
end $fn$;

create or replace function public.qb_export_build_h(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_cols text[]; v_rows jsonb; v_total bigint;
begin
  case p_dataset
  when 'teachers' then
    v_cols := array['Joined (UTC)', 'Name', 'Email', 'School', 'Region', 'Status', 'Classes', 'Active learners'];
    with f as (select t.created_at as k, jsonb_build_array(public.qb_export_ts(t.created_at), u.full_name, u.email, t.school_name, t.region, lower(t.status::text),
        (select count(*) from public.classes c where c.teacher_user_id = t.user_id), (select count(*) from public.class_memberships m join public.classes c on c.id = m.class_id where c.teacher_user_id = t.user_id and lower(m.status::text) = 'active')) as r
      from public.teacher_profiles t left join public.profiles u on u.id = t.user_id
      where (p_from is null or t.created_at >= p_from) and (p_to is null or t.created_at < p_to) and (p_category is null or lower(t.status::text) = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'learners' then
    v_cols := array['Joined (UTC)', 'Name', 'Email', 'Grade', 'School', 'Region', 'Status'];
    with f as (select s.created_at as k, jsonb_build_array(public.qb_export_ts(s.created_at), u.full_name, u.email, s.grade::text, s.school_name, s.region, lower(s.status::text)) as r
      from public.student_profiles s left join public.profiles u on u.id = s.user_id
      where not coalesce(s.is_minor, false)
        and (p_from is null or s.created_at >= p_from) and (p_to is null or s.created_at < p_to) and (p_category is null or s.grade::text = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  else return null;
  end case;
  return jsonb_build_object('columns', to_jsonb(v_cols), 'rows', v_rows, 'total', v_total, 'truncated', v_total > jsonb_array_length(v_rows));
end $fn$;

create or replace function public.qb_export_build(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare r jsonb;
begin
  r := coalesce(public.qb_export_build_a(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_b(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_c(p_dataset, p_from, p_to, p_category, p_limit),
    public.qb_export_build_d(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_e(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_f(p_dataset, p_from, p_to, p_category, p_limit),
    public.qb_export_build_g(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_h(p_dataset, p_from, p_to, p_category, p_limit));
  if r is null then raise exception 'QB_UNKNOWN_DATASET' using errcode = '22023'; end if;
  return r;
end $fn$;

revoke all on function public.qb_export_defs_a(), public.qb_export_defs_b(), public.qb_export_defs(), public.qb_export_build(text, timestamptz, timestamptz, text, integer),
  public.qb_export_build_f(text, timestamptz, timestamptz, text, integer), public.qb_export_build_g(text, timestamptz, timestamptz, text, integer), public.qb_export_build_h(text, timestamptz, timestamptz, text, integer) from public, anon, authenticated;

notify pgrst, 'reload schema';

