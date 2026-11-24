-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Family: give an exam to the children the sponsor may assign work to
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mock_family_give(p_exam uuid, p_students uuid[]) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); e public.mock_exams := quizbox_mock.own_exam(p_exam, true); v public.mock_exam_versions; sid uuid; g public.mock_exam_grants; n integer := 0; v_stale integer; v_name text;
  v_days integer := quizbox_mock.num('mock_exams.access_days', 90)::integer;
begin
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  if e.current_version_id is null then raise exception 'QB_MOCK_NOT_PUBLISHED' using errcode = '55000'; end if;
  if p_students is null or cardinality(p_students) not between 1 and 20 then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  foreach sid in array p_students loop
    if not quizbox_core.family_can(uid, sid, 'assign') then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  end loop;
  select * into v from public.mock_exam_versions where id = e.current_version_id;
  v_stale := quizbox_mock.stale(v.id);
  if v_stale > 0 then raise exception 'QB_MOCK_VERSION_STALE: % question(s) changed or were withdrawn since version % was published', v_stale, v.version_no using errcode = '55000'; end if;
  select coalesce(nullif(full_name, ''), 'Your family') into v_name from public.profiles where id = uid;
  foreach sid in array p_students loop
    update public.mock_exam_grants set status = 'revoked' where kind = 'family' and version_id = v.id and student_user_id = sid and granted_by = uid and status = 'active' and expires_at <= now();
    if not exists (select 1 from public.mock_exam_grants where kind = 'family' and version_id = v.id and student_user_id = sid and granted_by = uid and status = 'active') then
      insert into public.mock_exam_grants(exam_id, version_id, kind, granted_by, student_user_id, expires_at) values (e.id, v.id, 'family', uid, sid, now() + make_interval(days => v_days)) returning * into g;
      perform quizbox_mock.ensure_grant_enrolment(g.id);
      begin
        insert into public.notifications(recipient_user_id, recipient_role, type, title, message)
        values (sid, 'student', 'mock_exam_gift', 'A mock exam from ' || v_name, v_name || ' gave you the mock exam "' || e.title || '". Find it under My mock exams.');
      exception when others then null;   -- a notice must never undo the gift
      end;
      n := n + 1;
    end if;
  end loop;
  perform quizbox_core.audit('mock_exam.family_give', 'mock_exams', e.id, jsonb_build_object('version', v.version_no, 'children', n));
  return jsonb_build_object('given', n, 'already', cardinality(p_students) - n, 'version_no', v.version_no, 'days', v_days);
end $fn$;

create or replace function public.qb_mock_family_revoke(p_exam uuid, p_student uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true); n integer;
begin
  update public.mock_exam_grants set status = 'revoked' where exam_id = e.id and kind = 'family' and granted_by = auth.uid() and student_user_id = p_student and status = 'active';
  get diagnostics n = row_count;
  perform quizbox_core.audit('mock_exam.family_revoke', 'mock_exams', e.id, jsonb_build_object('revoked', n));
  return jsonb_build_object('revoked', n);
end $fn$;

-- Who in the family already has this exam, with how far they got.
create or replace function public.qb_mock_family_given(p_exam uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, false);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('grant_id', g.id, 'student_id', g.student_user_id, 'name', coalesce(p.full_name, 'Learner'), 'version_no', v.version_no, 'expires_at', g.expires_at,
      'active', g.status = 'active' and g.expires_at > now(), 'status', g.status, 'attempts_used', (select count(*) from public.attempts a where a.assessment_id = en.assessment_id),
      'last_percent', (select a.percentage from public.attempts a where a.assessment_id = en.assessment_id and a.status::text = 'submitted' order by a.submitted_at desc limit 1)) order by g.created_at desc)
    from public.mock_exam_grants g join public.mock_exam_versions v on v.id = g.version_id left join public.profiles p on p.id = g.student_user_id left join public.mock_exam_enrolments en on en.grant_id = g.id
   where g.exam_id = e.id and g.kind = 'family' and g.granted_by = auth.uid()), '[]'::jsonb);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Shared link with paid places
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function quizbox_mock.link_owner(p_exam uuid) returns public.mock_exams language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true);
begin
  if not coalesce(quizbox_core.flag('flags.mock_exam_links'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  if not quizbox_mock.link_sponsor(auth.uid()) then raise exception 'QB_MOCK_LINK_SPONSORS_ONLY' using errcode = '42501'; end if;
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  if e.current_version_id is null then raise exception 'QB_MOCK_NOT_PUBLISHED' using errcode = '55000'; end if;
  return e;
end $fn$;

create or replace function quizbox_mock.link_json(l public.mock_exam_links) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('id', l.id, 'code', l.code, 'path', '/mock-exams/join/' || l.code, 'version_no', v.version_no, 'seats_paid', l.seats_paid, 'coins_paid', l.coins_paid,
    'joined', (select count(*) from public.mock_exam_grants g where g.link_id = l.id), 'closes_at', l.closes_at, 'status', case when l.status = 'closed' then 'closed' when l.closes_at <= now() then 'ended' else 'open' end,
    'behind_current', e.current_version_id is distinct from l.version_id, 'created_at', l.created_at,
    'attempts', (select count(*) from public.mock_exam_enrolments en join public.mock_exam_grants g on g.id = en.grant_id join public.attempts a on a.assessment_id = en.assessment_id where g.link_id = l.id))
    from public.mock_exam_versions v join public.mock_exams e on e.id = v.exam_id where v.id = l.version_id
$fn$;
