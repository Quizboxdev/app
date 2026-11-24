create or replace function quizbox_mock.listing_json(it public.mk_items) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('item_id', it.id, 'slug', it.slug, 'status', it.status, 'title', it.title, 'description', it.description, 'subject', it.subject, 'grade', it.grade, 'term', it.term, 'school', it.school_name,
    'price_minor', it.price_minor, 'seller_share_minor', (public.qb_mk_split(it.price_minor::bigint))[1], 'platform_fee_minor', (public.qb_mk_split(it.price_minor::bigint))[2],
    'seller_share_percent', public.qb_mk_num('marketplace.seller_share_percent', 60), 'access_days', public.qb_mk_num('marketplace.access_days', 90),
    'min_price_minor', public.qb_mk_num('marketplace.min_price_minor', 500), 'max_price_minor', public.qb_mk_num('marketplace.max_price_minor', 20000), 'min_questions', public.qb_mk_num('marketplace.min_questions', 10),
    'question_count', it.question_count, 'review_note', it.review_note, 'mock_exam_id', it.mock_exam_id, 'version_no', (select v.version_no from public.mock_exam_versions v where v.id = it.mock_version_id),
    'behind_current', (select e.current_version_id is distinct from it.mock_version_id from public.mock_exams e where e.id = it.mock_exam_id))
$fn$;

-- Triggers --------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function quizbox_mock.purchase_version() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  select i.mock_version_id into new.mock_version_id from public.mk_items i where i.id = new.item_id;
  return new;
end $fn$;
drop trigger if exists mk_purchases_mock_version on public.mk_purchases;
create trigger mk_purchases_mock_version before insert on public.mk_purchases for each row execute function quizbox_mock.purchase_version();

create or replace function quizbox_mock.purchase_enrol() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if new.mock_version_id is not null then
    begin perform quizbox_mock.ensure_enrolment(new.id);
    exception when others then null;   -- a sale must never fail because the copy could not be opened now; it is opened when the buyer starts
    end;
  end if;
  return null;
end $fn$;
drop trigger if exists mk_purchases_mock_enrol on public.mk_purchases;
create trigger mk_purchases_mock_enrol after insert on public.mk_purchases for each row execute function quizbox_mock.purchase_enrol();

create or replace function quizbox_mock.no_question_copy() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if exists (select 1 from public.mk_items i where i.id = coalesce(new.item_id, old.item_id) and i.mock_exam_id is not null) then raise exception 'QB_MOCK_ITEM_HAS_NO_QUESTION_COPY' using errcode = '55000'; end if;
  return coalesce(new, old);
end $fn$;
drop trigger if exists mk_questions_no_mock_copy on public.mk_questions;
create trigger mk_questions_no_mock_copy before insert or update or delete on public.mk_questions for each row execute function quizbox_mock.no_question_copy();

create or replace function quizbox_mock.attempt_guard() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if exists (select 1 from public.assessments a where a.id = new.assessment_id and a.reference_type = 'MOCK_EXAM') and not quizbox_mock.entitled(new.assessment_id, new.student_user_id) then
    raise exception 'QB_MOCK_ENTITLEMENT_REQUIRED' using errcode = '42501';
  end if;
  return new;
end $fn$;
drop trigger if exists attempts_mock_entitlement on public.attempts;
create trigger attempts_mock_entitlement before insert on public.attempts for each row execute function quizbox_mock.attempt_guard();

create or replace function quizbox_mock.exam_archived() returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if new.status = 'archived' and old.status is distinct from 'archived' then
    update public.mk_items set status = 'unlisted', updated_at = now() where mock_exam_id = new.id and status in ('approved', 'submitted');
  end if;
  return null;
end $fn$;
drop trigger if exists mock_exams_unlist_on_archive on public.mock_exams;
create trigger mock_exams_unlist_on_archive after update of status on public.mock_exams for each row execute function quizbox_mock.exam_archived();

revoke all on function quizbox_mock.entitled(uuid, uuid), quizbox_mock.open_copy(uuid, uuid, timestamptz), quizbox_mock.ensure_enrolment(uuid), quizbox_mock.listing_json(public.mk_items), quizbox_mock.purchase_version(), quizbox_mock.purchase_enrol(),
  quizbox_mock.no_question_copy(), quizbox_mock.attempt_guard(), quizbox_mock.exam_archived() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Seller: prepare, review, submit, take off sale
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function quizbox_mock.sellable(p_exam uuid, p_lock boolean default true) returns public.mock_exams language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, p_lock);
begin
  if not coalesce(quizbox_core.flag('flags.marketplace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  if e.owner_kind not in ('teacher', 'sponsor') then raise exception 'QB_MOCK_SELL_NOT_ALLOWED' using errcode = '42501'; end if;
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  if e.current_version_id is null then raise exception 'QB_MOCK_NOT_PUBLISHED' using errcode = '55000'; end if;
  return e;
end $fn$;
revoke all on function quizbox_mock.sellable(uuid, boolean) from public, anon, authenticated;
