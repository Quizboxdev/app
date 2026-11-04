-- Opening topics to teachers. Questions are loaded with their topics as DRAFT; a topic is offered to teachers (the "assign by topic" and combined-test screens) only
-- when it is ACTIVE, and the one function that did that (qb_topic_set_status) works on a single topic and had no screen. With 643 topics that is not workable.
-- This adds, for content admins and the owner:
--   * qb_topics_overview(): per subject and grade, how many topics are open (ACTIVE), ready to open (DRAFT with at least its target of approved questions),
--     not ready (DRAFT with fewer), and how many approved questions they hold.
--   * qb_topics_set_open(open, subject, grade): opens every ready DRAFT topic in the chosen subject and grade (or all), or withdraws the open ones back to DRAFT.
--     A topic is opened only if it meets the same rule as qb_topic_set_status (approved, active questions at or above its target). Each use is written to audit_logs.
-- Withdrawing a topic never touches an assignment already published from it. Additive. Rollback: supabase/rollback/topics_for_teachers.sql.
begin;

create or replace function public.qb_topics_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_sme.has_capability('content_admin') then raise exception 'QB_TOPIC_ACCESS_DENIED' using errcode = '42501'; end if;
  return coalesce((
    with a as (
      select l.topic_id, count(*)::integer as approved from public.question_topic_links l join public.questions q on q.id = l.question_id
       where q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated') group by l.topic_id),
    t as (
      select tp.status, tp.target_questions, coalesce(a.approved, 0) as approved, n.subject_code as subject, coalesce(n.canonical_grade_code, n.grade_code) as grade
        from public.curriculum_topics tp join public.curriculum_nodes n on n.id = tp.indicator_node_id left join a on a.topic_id = tp.id),
    g as (
      select subject, grade, count(*) filter (where status = 'ACTIVE')::integer as open_topics,
             count(*) filter (where status = 'DRAFT' and approved >= target_questions)::integer as ready,
             count(*) filter (where status = 'DRAFT' and approved < target_questions)::integer as not_ready,
             count(*)::integer as topics, coalesce(sum(approved), 0)::integer as approved_questions
        from t group by subject, grade)
    select jsonb_agg(jsonb_build_object('subject', subject, 'grade', grade, 'open', open_topics, 'ready', ready, 'not_ready', not_ready, 'topics', topics, 'approved_questions', approved_questions)
                     order by grade, subject) from g), '[]'::jsonb);
end $fn$;

create or replace function public.qb_topics_set_open(p_open boolean, p_subject text default null, p_grade text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare changed integer; waiting integer := 0; subj text := nullif(btrim(coalesce(p_subject, '')), ''); grd text := nullif(btrim(coalesce(p_grade, '')), '');
begin
  if auth.uid() is null or not quizbox_sme.has_capability('content_admin') then raise exception 'QB_TOPIC_ACCESS_DENIED' using errcode = '42501'; end if;
  if p_open is null then raise exception 'QB_TOPIC_INVALID_STATUS'; end if;
  if p_open then
    with a as (
      select l.topic_id, count(*)::integer as approved from public.question_topic_links l join public.questions q on q.id = l.question_id
       where q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated') group by l.topic_id),
    pick as (
      select tp.id, coalesce(a.approved, 0) >= tp.target_questions as ready
        from public.curriculum_topics tp join public.curriculum_nodes n on n.id = tp.indicator_node_id left join a on a.topic_id = tp.id
       where tp.status = 'DRAFT' and (subj is null or n.subject_code = subj) and (grd is null or coalesce(n.canonical_grade_code, n.grade_code) = grd)),
    done as (update public.curriculum_topics set status = 'ACTIVE', updated_at = now() where id in (select id from pick where ready) returning 1)
    select (select count(*) from done), (select count(*) from pick where not ready) into changed, waiting;
  else
    update public.curriculum_topics tp set status = 'DRAFT', updated_at = now()
     from public.curriculum_nodes n
     where n.id = tp.indicator_node_id and tp.status = 'ACTIVE' and (subj is null or n.subject_code = subj) and (grd is null or coalesce(n.canonical_grade_code, n.grade_code) = grd);
    get diagnostics changed = row_count;
  end if;
  insert into public.audit_logs(actor_user_id, action, entity_type, status, details)
  values (auth.uid(), case when p_open then 'topics_opened' else 'topics_withdrawn' end, 'curriculum_topics', 'pass',
          jsonb_build_object('subject', subj, 'grade', grd, 'changed', changed, 'not_ready', waiting));
  return jsonb_build_object('changed', changed, 'not_ready', waiting, 'opened', p_open);
end $fn$;

revoke all on function public.qb_topics_overview(), public.qb_topics_set_open(boolean, text, text) from public, anon;
grant execute on function public.qb_topics_overview(), public.qb_topics_set_open(boolean, text, text) to authenticated;

commit;
