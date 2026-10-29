create or replace function public.qb_export_build_d(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_cols text[]; v_rows jsonb; v_total bigint;
begin
  case p_dataset
  when 'challenges' then
    v_cols := array['Created (UTC)', 'Title', 'Type', 'Format', 'Status', 'Visibility', 'Questions', 'Starts (UTC)', 'Ends (UTC)', 'Players', 'Attempts', 'Owner email'];
    with f as (select c.created_at as k, jsonb_build_array(public.qb_export_ts(c.created_at), c.title, c.category, c.format, c.status, c.visibility, c.question_count, public.qb_export_ts(c.starts_at), public.qb_export_ts(c.ends_at),
        (select count(*) from public.challenge_participants p where p.campaign_id = c.id), (select count(*) from public.challenge_attempts a where a.campaign_id = c.id), u.email) as r
      from public.challenge_campaigns c left join public.profiles u on u.id = c.owner_id
      where (p_from is null or c.created_at >= p_from) and (p_to is null or c.created_at < p_to) and (p_category is null or c.category = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'challenge_attempts' then
    v_cols := array['Started (UTC)', 'Challenge', 'Type', 'Learner code', 'Attempt', 'Score', 'Out of', 'Percent', 'Seconds taken', 'Submitted', 'Timed out'];
    with f as (select a.started_at as k, jsonb_build_array(public.qb_export_ts(a.started_at), c.title, c.category, left(md5(a.user_id::text), 10), a.attempt_no, a.score, a.max_score,
        case when coalesce(a.max_score, 0) > 0 then round(100.0 * a.score / a.max_score, 1) end, round(a.duration_ms / 1000.0, 1), a.submitted_at is not null, a.expired) as r
      from public.challenge_attempts a join public.challenge_campaigns c on c.id = a.campaign_id
      where (p_from is null or a.started_at >= p_from) and (p_to is null or a.started_at < p_to) and (p_category is null or c.category = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'question_bank' then
    v_cols := array['Subject', 'Grade', 'Status', 'Questions'];
    with f as (select count(*) as k, jsonb_build_array(q.subject_name, q.grade::text, q.status::text, count(*)) as r
      from public.questions q
      where (p_from is null or q.created_at >= p_from) and (p_to is null or q.created_at < p_to) and (p_category is null or q.subject_name = p_category)
      group by q.subject_name, q.grade::text, q.status::text)
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'question_batches' then
    v_cols := array['Created (UTC)', 'File', 'Scope', 'Status', 'Rows in file', 'Rows loaded', 'Rows rejected', 'Completed (UTC)', 'Uploaded by'];
    with f as (select b.created_at as k, jsonb_build_array(public.qb_export_ts(b.created_at), b.file_name, b.scope, b.status, b.rows_total, b.rows_loaded, b.rows_rejected, public.qb_export_ts(b.completed_at), u.email) as r
      from public.question_load_batches b left join public.profiles u on u.id = b.uploaded_by
      where (p_from is null or b.created_at >= p_from) and (p_to is null or b.created_at < p_to) and (p_category is null or b.status = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  else return null;
  end case;
  return jsonb_build_object('columns', to_jsonb(v_cols), 'rows', v_rows, 'total', v_total, 'truncated', v_total > jsonb_array_length(v_rows));
end $fn$;

create or replace function public.qb_export_build_e(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_cols text[]; v_rows jsonb; v_total bigint;
begin
  case p_dataset
  when 'users' then
    v_cols := array['Created (UTC)', 'Role', 'Status', 'Name', 'Email', 'Country', 'Region', 'School'];
    with f as (select u.created_at as k, jsonb_build_array(public.qb_export_ts(u.created_at), lower(u.role::text), lower(u.status::text), u.full_name, u.email, u.country, u.region, u.school_name) as r
      from public.profiles u
      where not exists (select 1 from public.student_profiles sp where sp.user_id = u.id and sp.is_minor)
        and (p_from is null or u.created_at >= p_from) and (p_to is null or u.created_at < p_to) and (p_category is null or lower(u.role::text) = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'policy_acceptances' then
    v_cols := array['Accepted (UTC)', 'Policy', 'Version', 'Account email', 'Role'];
    with f as (select pa.accepted_at as k, jsonb_build_array(public.qb_export_ts(pa.accepted_at), d.title, v.version_no, u.email, lower(u.role::text)) as r
      from public.policy_acceptances pa join public.policy_versions v on v.id = pa.version_id join public.policy_documents d on d.id = v.document_id left join public.profiles u on u.id = pa.user_id
      where not exists (select 1 from public.student_profiles sp where sp.user_id = pa.user_id and sp.is_minor)
        and (p_from is null or pa.accepted_at >= p_from) and (p_to is null or pa.accepted_at < p_to) and (p_category is null or d.slug = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  when 'audit_log' then
    v_cols := array['Time (UTC)', 'Actor email', 'Actor role', 'Action', 'Area', 'Record type', 'Record id', 'Outcome', 'Details'];
    with f as (select a.created_at as k, jsonb_build_array(public.qb_export_ts(a.created_at), u.email, lower(a.actor_role::text), a.action, split_part(a.action, '.', 1), a.entity_type, a.entity_id, a.status, left(a.details::text, 500)) as r
      from public.audit_logs a left join public.profiles u on u.id = a.actor_user_id
      where (p_from is null or a.created_at >= p_from) and (p_to is null or a.created_at < p_to) and (p_category is null or split_part(a.action, '.', 1) = p_category))
    select (select count(*) from f), coalesce((select jsonb_agg(x.r order by x.k desc) from (select r, k from f order by k desc limit p_limit) x), '[]'::jsonb) into v_total, v_rows;
  else return null;
  end case;
  return jsonb_build_object('columns', to_jsonb(v_cols), 'rows', v_rows, 'total', v_total, 'truncated', v_total > jsonb_array_length(v_rows));
end $fn$;

create or replace function public.qb_export_build(p_dataset text, p_from timestamptz, p_to timestamptz, p_category text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare r jsonb;
begin
  r := coalesce(public.qb_export_build_a(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_b(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_c(p_dataset, p_from, p_to, p_category, p_limit),
    public.qb_export_build_d(p_dataset, p_from, p_to, p_category, p_limit), public.qb_export_build_e(p_dataset, p_from, p_to, p_category, p_limit));
  if r is null then raise exception 'QB_UNKNOWN_DATASET' using errcode = '22023'; end if;
  return r;
end $fn$;
