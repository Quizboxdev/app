-- For the staff who approve listings: what the exam really contains (the generic review shows no questions for a mock exam).
create or replace function public.qb_mock_admin_listing(p_item uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare it public.mk_items; v public.mock_exam_versions;
begin
  if not public.qb_mk_is_staff('review') then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  select * into it from public.mk_items where id = p_item and mock_exam_id is not null;
  if it.id is null then return null; end if;
  select * into v from public.mock_exam_versions where id = it.mock_version_id;
  return jsonb_build_object('version_no', v.version_no, 'purpose', v.purpose, 'target_grade', v.target_grade, 'question_count', v.question_count, 'total_marks', v.total_marks, 'time_limit_minutes', v.time_limit_minutes,
    'attempts_allowed', v.attempts_allowed, 'rounds', v.rounds, 'stale_questions', quizbox_mock.stale(v.id),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('position', vq.position, 'grade_code', vq.grade_code, 'subject_code', vq.subject_code, 'answer_type', coalesce(vq.answer_type, 'SINGLE_CHOICE'), 'question_text', vq.question_text,
        'correct_answer', quizbox_mock.correct_text(vq)) order by vq.position) from public.mock_exam_version_questions vq where vq.version_id = v.id), '[]'::jsonb));
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Buyer
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- What a buyer may know before paying: the shape of the exam, never a question or an answer.
create or replace function public.qb_mock_listing_info(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare it public.mk_items; v public.mock_exam_versions;
begin
  if not coalesce(quizbox_core.flag('flags.marketplace'), false) then return null; end if;
  select * into it from public.mk_items where slug = lower(btrim(coalesce(p_slug, ''))) and status = 'approved' and mock_exam_id is not null;
  if it.id is null then return null; end if;
  select * into v from public.mock_exam_versions where id = it.mock_version_id;
  return jsonb_build_object('mock_exam', true, 'version_no', v.version_no, 'purpose', v.purpose, 'target_grade', v.target_grade, 'question_count', v.question_count, 'total_marks', v.total_marks, 'time_limit_minutes', v.time_limit_minutes,
    'attempts_allowed', v.attempts_allowed, 'access_days', public.qb_mk_num('marketplace.access_days', 90),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('grade_code', x ->> 'grade_code', 'subject_label', x ->> 'subject_label', 'topic_title', x ->> 'topic_title', 'questions', (x ->> 'selected')::integer) order by (x ->> 'position')::integer)
                          from jsonb_array_elements(v.rounds) x), '[]'::jsonb));
end $fn$;

create or replace function public.qb_mock_listing_kinds(p_slugs text[]) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select case when not coalesce(quizbox_core.flag('flags.marketplace'), false) then '[]'::jsonb
    else coalesce((select jsonb_agg(i.slug) from public.mk_items i where i.slug = any (coalesce(p_slugs, '{}')) and i.status = 'approved' and i.mock_exam_id is not null), '[]'::jsonb) end
$fn$;

create or replace function public.qb_mock_my_purchases() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('purchase_id', p.id, 'item_id', p.item_id, 'slug', i.slug, 'title', p.item_title, 'expires_at', p.expires_at, 'active', p.status = 'active' and p.expires_at > now(),
      'days_left', greatest(0, ceil(extract(epoch from (p.expires_at - now())) / 86400))::int, 'status', p.status, 'version_no', v.version_no, 'question_count', v.question_count, 'time_limit_minutes', v.time_limit_minutes,
      'attempts_allowed', v.attempts_allowed, 'attempts_used', (select count(*) from public.attempts a where a.assessment_id = en.assessment_id),
      'in_progress_attempt', (select a.id from public.attempts a where a.assessment_id = en.assessment_id and a.status::text = 'in_progress' order by a.started_at desc limit 1),
      'last_attempt', (select jsonb_build_object('id', a.id, 'state', a.status::text, 'percent', a.percentage) from public.attempts a where a.assessment_id = en.assessment_id order by a.started_at desc limit 1)) order by p.purchased_at desc)
    from public.mk_purchases p join public.mk_items i on i.id = p.item_id join public.mock_exam_versions v on v.id = p.mock_version_id left join public.mock_exam_enrolments en on en.purchase_id = p.id
    where p.buyer_user_id = auth.uid() and p.mock_version_id is not null), '[]'::jsonb);
end $fn$;

-- Opens (or returns) the buyer's private copy and says which assessment to start. The attempt itself is started by the normal engine, whose attempt guard checks the purchase again.
create or replace function public.qb_mock_start_purchased(p_purchase uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare pur public.mk_purchases; en_id uuid; en public.mock_exam_enrolments;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not coalesce(quizbox_core.flag('flags.mock_exams'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  select * into pur from public.mk_purchases where id = p_purchase and buyer_user_id = auth.uid() and mock_version_id is not null;
  if pur.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  if pur.status <> 'active' or pur.expires_at <= now() then raise exception 'QB_MOCK_ENTITLEMENT_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid()) then raise exception 'QB_STUDENT_REQUIRED' using errcode = '42501'; end if;
  en_id := quizbox_mock.ensure_enrolment(pur.id);
  select * into en from public.mock_exam_enrolments where id = en_id;
  return jsonb_build_object('assessment_id', en.assessment_id, 'enrolment_id', en.id, 'version_no', (select version_no from public.mock_exam_versions where id = en.version_id), 'expires_at', pur.expires_at);
end $fn$;

revoke all on function public.qb_mock_listing_prepare(uuid, integer, text, text), public.qb_mock_listing_get(uuid), public.qb_mock_listing_submit(uuid), public.qb_mock_listing_unlist(uuid), public.qb_mock_admin_listing(uuid),
  public.qb_mock_listing_info(text), public.qb_mock_listing_kinds(text[]), public.qb_mock_my_purchases(), public.qb_mock_start_purchased(uuid) from public, anon;
grant execute on function public.qb_mock_listing_prepare(uuid, integer, text, text), public.qb_mock_listing_get(uuid), public.qb_mock_listing_submit(uuid), public.qb_mock_listing_unlist(uuid), public.qb_mock_admin_listing(uuid),
  public.qb_mock_my_purchases(), public.qb_mock_start_purchased(uuid) to authenticated, service_role;
grant execute on function public.qb_mock_listing_info(text), public.qb_mock_listing_kinds(text[]) to anon, authenticated, service_role;
