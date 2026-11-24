-- Join: takes one place, opens the person's own copy. Safe to repeat. A person already in keeps their place even when the link is full or closed.
create or replace function public.qb_mock_link_join(p_code text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); l public.mock_exam_links; e public.mock_exams; g public.mock_exam_grants; en_id uuid; n integer; v_days integer := quizbox_mock.num('mock_exams.access_days', 90)::integer;
begin
  if uid is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not coalesce(quizbox_core.flag('flags.mock_exams'), false) or not coalesce(quizbox_core.flag('flags.mock_exam_links'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  select * into l from public.mock_exam_links where code = lower(btrim(coalesce(p_code, ''))) for update;
  if l.id is null then raise exception 'QB_MOCK_LINK_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into g from public.mock_exam_grants where link_id = l.id and student_user_id = uid;
  if g.id is not null then
    en_id := quizbox_mock.ensure_grant_enrolment(g.id);
    return jsonb_build_object('ok', true, 'already', true, 'grant_id', g.id, 'expires_at', g.expires_at);
  end if;
  if l.owner_user_id = uid then raise exception 'QB_MOCK_OWN_EXAM' using errcode = '42501'; end if;
  if not public.qb_challenge_active_user() then raise exception 'QB_MOCK_JOIN_NOT_ALLOWED' using errcode = '42501'; end if;
  if not exists (select 1 from public.student_profiles sp where sp.user_id = uid) then raise exception 'QB_STUDENT_REQUIRED' using errcode = '42501'; end if;
  select * into e from public.mock_exams where id = l.exam_id;
  if l.status <> 'open' or l.closes_at <= now() or e.status = 'archived' then raise exception 'QB_MOCK_LINK_CLOSED' using errcode = '55000'; end if;
  select count(*) into n from public.mock_exam_grants where link_id = l.id;
  if n >= l.seats_paid then raise exception 'QB_MOCK_LINK_FULL' using errcode = '55000'; end if;
  insert into public.mock_exam_grants(exam_id, version_id, kind, granted_by, link_id, student_user_id, expires_at) values (l.exam_id, l.version_id, 'link', l.owner_user_id, l.id, uid, now() + make_interval(days => v_days)) returning * into g;
  en_id := quizbox_mock.ensure_grant_enrolment(g.id);     -- if a question changed since publishing this raises and the place is not taken
  return jsonb_build_object('ok', true, 'already', false, 'grant_id', g.id, 'expires_at', g.expires_at);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- The learner's side: my gifts and joins, and starting one
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mock_my_grants() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('grant_id', g.id, 'source', g.kind, 'title', e.title, 'from', coalesce((select nullif(p.full_name, '') from public.profiles p where p.id = g.granted_by), 'A sponsor'),
      'expires_at', g.expires_at, 'active', g.status = 'active' and g.expires_at > now(), 'days_left', greatest(0, ceil(extract(epoch from (g.expires_at - now())) / 86400))::int, 'status', g.status,
      'version_no', v.version_no, 'question_count', v.question_count, 'time_limit_minutes', v.time_limit_minutes, 'attempts_allowed', v.attempts_allowed,
      'attempts_used', (select count(*) from public.attempts a where a.assessment_id = en.assessment_id),
      'in_progress_attempt', (select a.id from public.attempts a where a.assessment_id = en.assessment_id and a.status::text = 'in_progress' order by a.started_at desc limit 1),
      'last_attempt', (select jsonb_build_object('id', a.id, 'state', a.status::text, 'percent', a.percentage) from public.attempts a where a.assessment_id = en.assessment_id order by a.started_at desc limit 1)) order by g.created_at desc)
    from public.mock_exam_grants g join public.mock_exams e on e.id = g.exam_id join public.mock_exam_versions v on v.id = g.version_id left join public.mock_exam_enrolments en on en.grant_id = g.id
   where g.student_user_id = auth.uid()), '[]'::jsonb);
end $fn$;

create or replace function public.qb_mock_start_granted(p_grant uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare g public.mock_exam_grants; en public.mock_exam_enrolments; en_id uuid;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not coalesce(quizbox_core.flag('flags.mock_exams'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  select * into g from public.mock_exam_grants where id = p_grant and student_user_id = auth.uid();
  if g.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if g.status <> 'active' or g.expires_at <= now() then raise exception 'QB_MOCK_ENTITLEMENT_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid()) then raise exception 'QB_STUDENT_REQUIRED' using errcode = '42501'; end if;
  en_id := quizbox_mock.ensure_grant_enrolment(g.id);
  select * into en from public.mock_exam_enrolments where id = en_id;
  return jsonb_build_object('assessment_id', en.assessment_id, 'enrolment_id', en.id, 'version_no', (select version_no from public.mock_exam_versions where id = en.version_id), 'expires_at', g.expires_at);
end $fn$;

revoke all on function quizbox_mock.link_sponsor(uuid), quizbox_mock.ensure_grant_enrolment(uuid), quizbox_mock.link_owner(uuid), quizbox_mock.link_json(public.mock_exam_links) from public, anon, authenticated;
revoke all on function public.qb_mock_family_give(uuid, uuid[]), public.qb_mock_family_revoke(uuid, uuid), public.qb_mock_family_given(uuid), public.qb_mock_link_create(uuid, integer, timestamptz),
  public.qb_mock_link_add_seats(uuid, integer), public.qb_mock_link_close(uuid), public.qb_mock_links(uuid), public.qb_mock_link_info(text), public.qb_mock_link_join(text), public.qb_mock_my_grants(),
  public.qb_mock_start_granted(uuid) from public, anon;
grant execute on function public.qb_mock_family_give(uuid, uuid[]), public.qb_mock_family_revoke(uuid, uuid), public.qb_mock_family_given(uuid), public.qb_mock_link_create(uuid, integer, timestamptz),
  public.qb_mock_link_add_seats(uuid, integer), public.qb_mock_link_close(uuid), public.qb_mock_links(uuid), public.qb_mock_link_info(text), public.qb_mock_link_join(text), public.qb_mock_my_grants(),
  public.qb_mock_start_granted(uuid) to authenticated, service_role;


notify pgrst, 'reload schema';
