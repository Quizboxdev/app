-- Mock exams, part 3 of 3: selling an exam on the Marketplace, and delivering it only to people who paid. Needs 20261043100000_marketplace.sql and the two earlier mock-exam migrations.
-- No parallel payment system. A mock exam is an ordinary Marketplace listing (mk_items) with no question copy (mk_questions), pinned to one published version:
--   listing     qb_mock_listing_prepare (price and terms; a seller may still be pending) -> qb_mock_listing_submit (the existing staff review) -> approved -> shown in the catalogue.
--   purchase    the existing /api/marketplace/checkout, Paystack, qb_mk_fulfil_purchase (idempotent: one purchase per payment reference), 60/40 split, 90 days, and the existing refund reversal. Unchanged.
--   delivery    an AFTER INSERT trigger on mk_purchases opens the buyer's private copy of the PURCHASED version (an assessment owned by the buyer, reference_type MOCK_EXAM) and records an enrolment.
--               It never blocks a sale: if it fails, qb_mock_start_purchased creates it when the buyer starts.
--   guard       a BEFORE INSERT trigger on attempts refuses an attempt on a MOCK_EXAM assessment unless the buyer's purchase is active and unexpired. A refunded buyer cannot start a new attempt, and nobody
--               can start one by knowing the assessment id (qb_can_access_learning_assessment alone would allow it).
-- qb_mk_open returns no answers for a mock listing (there is nothing in mk_questions) and a trigger stops anyone adding questions to it.
-- Archiving an exam takes its listing off sale; purchases already made keep their access until they expire.
-- Sellers: a verified organisation sponsor may become a seller while flags.mock_exams is on (qb_mk_seller_save is replaced, otherwise unchanged); the Marketplace rules (verified seller, staff review, price limits, 60/40 split, payouts) are the same for everyone.
-- Additive: nullable columns, triggers that do nothing for any other row, new functions. Rollback: supabase/rollback/mock_exams_marketplace.sql.
-- Errors: QB_MOCK_SELL_NOT_ALLOWED, QB_MOCK_NOT_PUBLISHED, QB_MOCK_ARCHIVED, QB_MOCK_VERSION_STALE, QB_MOCK_NOT_LISTED, QB_MOCK_ENTITLEMENT_REQUIRED, QB_STUDENT_REQUIRED, QB_MOCK_ITEM_HAS_NO_QUESTION_COPY, QB_FEATURE_DISABLED.
begin;

alter table public.mk_items add column if not exists mock_exam_id uuid references public.mock_exams(id) on delete restrict;
alter table public.mk_items add column if not exists mock_version_id uuid references public.mock_exam_versions(id) on delete restrict;
alter table public.mk_purchases add column if not exists mock_version_id uuid references public.mock_exam_versions(id) on delete restrict;
create unique index if not exists mk_items_one_per_mock_exam on public.mk_items(mock_exam_id) where mock_exam_id is not null;
do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'mk_items_mock_pair') then
    alter table public.mk_items add constraint mk_items_mock_pair check ((mock_exam_id is null) = (mock_version_id is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mock_exam_enrolments_purchase_fk') then
    alter table public.mock_exam_enrolments add constraint mock_exam_enrolments_purchase_fk foreign key (purchase_id) references public.mk_purchases(id) on delete restrict;
  end if;
end $c$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Internal: entitlement, enrolment, listing shape
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function quizbox_mock.entitled(p_assessment uuid, p_user uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.mock_exam_enrolments en join public.mk_purchases p on p.id = en.purchase_id
                  where en.assessment_id = p_assessment and en.student_user_id = p_user and p.buyer_user_id = p_user and p.status = 'active' and p.expires_at > now())
$fn$;

-- Builds a learner's private copy of a published version: an assessment they own, with the version's frozen questions. If one of them has changed or been withdrawn since publishing, nothing is created.
-- Used for a purchase (below) and, in the sponsor migration, for a gift to a family member or a joiner by link. Returns the assessment id; the caller records the enrolment.
create or replace function quizbox_mock.open_copy(p_version uuid, p_user uuid, p_expires timestamptz) returns uuid language plpgsql security definer set search_path = '' as $fn$
declare v public.mock_exam_versions; a public.assessments; v_stale integer; v_subject text; v_subjects integer;
begin
  select * into v from public.mock_exam_versions where id = p_version;
  if v.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  v_stale := quizbox_mock.stale(v.id);
  if v_stale > 0 then raise exception 'QB_MOCK_VERSION_STALE: % question(s) changed or were withdrawn since version % was published', v_stale, v.version_no using errcode = '55000'; end if;
  select count(distinct x ->> 'subject_code')::integer, min(x ->> 'subject_label') into v_subjects, v_subject from jsonb_array_elements(v.rounds) x;
  insert into public.assessments(assessment_type, owner_role, owner_user_id, subject_code, subject_name, grade_code, question_count, difficulty, time_limit_minutes, max_attempts, allow_resume, auto_submit, pass_percent,
                                 expires_at, instructions, tenant_id, reference_type)
  values ('ASSESSMENT', 'student', p_user, case when v_subjects = 1 then (select min(x ->> 'subject_code') from jsonb_array_elements(v.rounds) x) else 'MIXED' end, case when v_subjects = 1 then v_subject else 'Mock exam' end,
          v.target_grade, v.question_count, 'mixed', v.time_limit_minutes, v.attempts_allowed, true, true, 40, p_expires, nullif(v.instructions, ''), public.qb_public_tenant_id(), 'MOCK_EXAM')
  returning * into a;
  insert into public.assessment_questions(assessment_id, question_id, question_order, question_text_snapshot, option_a_snapshot, option_b_snapshot, option_c_snapshot, option_d_snapshot, correct_answer_snapshot, marks_snapshot,
                                          question_content_snapshot, answer_type_snapshot, answer_spec_snapshot)
  select a.id, vq.question_id, row_number() over (order by case when v.shuffle_questions then random() end, vq.position)::integer, vq.question_text, vq.option_a, vq.option_b, vq.option_c, vq.option_d, vq.correct_answer, vq.marks,
         vq.question_content, vq.answer_type, vq.answer_spec
    from public.mock_exam_version_questions vq where vq.version_id = v.id;
  return a.id;
end $fn$;

-- Opens the buyer's private copy of the purchased version, once.
create or replace function quizbox_mock.ensure_enrolment(p_purchase uuid) returns uuid language plpgsql security definer set search_path = '' as $fn$
declare pur public.mk_purchases; en public.mock_exam_enrolments; v public.mock_exam_versions; a_id uuid;
begin
  select * into pur from public.mk_purchases where id = p_purchase for update;
  if pur.id is null or pur.mock_version_id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into en from public.mock_exam_enrolments where purchase_id = pur.id;
  if en.id is not null then return en.id; end if;
  select * into v from public.mock_exam_versions where id = pur.mock_version_id;
  a_id := quizbox_mock.open_copy(v.id, pur.buyer_user_id, pur.expires_at);
  insert into public.mock_exam_enrolments(exam_id, version_id, student_user_id, purchase_id, assessment_id) values (v.exam_id, v.id, pur.buyer_user_id, pur.id, a_id) returning * into en;
  update public.assessments set reference_id = en.id where id = a_id;
  return en.id;
end $fn$;

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

-- Becoming a seller: verified teachers as before, and (only while flags.mock_exams is on) verified ORGANIZATION sponsors. Everything else in this function is the original from 20261043100000
-- (same terms, same payout checks, same re-verification when payout details change). Rollback restores the original.
create or replace function public.qb_mk_seller_save(p_display_name text, p_school text, p_phone text, p_method text, p_network text, p_account text, p_account_name text, p_accept_terms boolean) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare s public.mk_sellers; v_changed boolean;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if not (exists (select 1 from public.profiles p where p.id = auth.uid() and upper(p.role::text) = 'TEACHER' and lower(p.status::text) = 'active')
          or (coalesce(quizbox_core.flag('flags.mock_exams'), false) and exists (select 1 from public.profiles p join public.sponsor_profiles sp on sp.user_id = p.id
               where p.id = auth.uid() and upper(p.role::text) = 'SPONSOR' and lower(p.status::text) = 'active' and upper(coalesce(sp.sponsor_type, 'ORGANIZATION')) = 'ORGANIZATION'
                 and upper(coalesce(sp.verification_status, '')) = 'VERIFIED' and lower(coalesce(sp.status::text, 'active')) = 'active'))) then raise exception 'QB_TEACHERS_ONLY' using errcode = '42501'; end if;
  select * into s from public.mk_sellers where user_id = auth.uid() for update;
  if s.id is not null and s.status = 'suspended' then raise exception 'QB_SELLER_SUSPENDED' using errcode = '55000'; end if;
  if s.terms_accepted_at is null and not coalesce(p_accept_terms, false) then raise exception 'QB_TERMS_REQUIRED' using errcode = '22023'; end if;
  begin
    if s.id is null then
      insert into public.mk_sellers(user_id, display_name, school_name, phone, payout_method, payout_network, payout_account, payout_account_name, terms_accepted_at)
      values (auth.uid(), btrim(p_display_name), btrim(p_school), btrim(p_phone), p_method, btrim(p_network), regexp_replace(coalesce(p_account, ''), '[ -]', '', 'g'), btrim(p_account_name), case when coalesce(p_accept_terms, false) then now() end) returning * into s;
    else
      v_changed := s.payout_method <> p_method or s.payout_network <> btrim(coalesce(p_network, '')) or s.payout_account <> regexp_replace(coalesce(p_account, ''), '[ -]', '', 'g') or s.payout_account_name <> btrim(coalesce(p_account_name, ''));
      update public.mk_sellers set display_name = btrim(p_display_name), school_name = btrim(p_school), phone = btrim(p_phone), payout_method = p_method, payout_network = btrim(p_network),
             payout_account = regexp_replace(coalesce(p_account, ''), '[ -]', '', 'g'), payout_account_name = btrim(p_account_name),
             terms_accepted_at = coalesce(terms_accepted_at, case when coalesce(p_accept_terms, false) then now() end),
             status = case when v_changed and status = 'verified' then 'pending' else status end, verified_at = case when v_changed and status = 'verified' then null else verified_at end,
             review_note = case when v_changed and status = 'verified' then 'Payout details changed: needs checking again.' else review_note end, updated_at = now()
       where id = s.id returning * into s;
    end if;
  exception when check_violation then raise exception 'QB_SELLER_INVALID' using errcode = '22023';
  end;
  return public.qb_mk_seller_get();
end $fn$;

-- Creates or updates the draft listing for the exam's current version. Nothing is on sale yet: the seller reviews the returned listing (price, split, access terms), then submits it.
create or replace function public.qb_mock_listing_prepare(p_exam uuid, p_price_minor integer, p_description text default null, p_term text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.sellable(p_exam, true); s public.mk_sellers := public.qb_mk_my_seller(); v public.mock_exam_versions; it public.mk_items; saved jsonb; v_subjects integer; v_subject text; v_stale integer;
begin
  select * into v from public.mock_exam_versions where id = e.current_version_id;
  v_stale := quizbox_mock.stale(v.id);
  if v_stale > 0 then raise exception 'QB_MOCK_VERSION_STALE: % question(s) changed or were withdrawn since version % was published', v_stale, v.version_no using errcode = '55000'; end if;
  select count(distinct x ->> 'subject_code')::integer, min(x ->> 'subject_label') into v_subjects, v_subject from jsonb_array_elements(v.rounds) x;
  select * into it from public.mk_items where mock_exam_id = e.id;
  saved := public.qb_mk_item_save(it.id, v.title, coalesce(nullif(btrim(coalesce(p_description, '')), ''), v.description), case when v_subjects = 1 then v_subject else 'Multiple subjects' end, v.target_grade, nullif(btrim(coalesce(p_term, '')), ''), s.school_name, p_price_minor);
  update public.mk_items set mock_exam_id = e.id, mock_version_id = v.id, question_count = v.question_count where id = (saved ->> 'id')::uuid returning * into it;
  perform quizbox_core.audit('mock_exam.listing_prepare', 'mock_exams', e.id, jsonb_build_object('item', it.id, 'version', v.version_no, 'price_minor', p_price_minor));
  return quizbox_mock.listing_json(it);
end $fn$;

create or replace function public.qb_mock_listing_get(p_exam uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam); it public.mk_items;
begin
  select * into it from public.mk_items where mock_exam_id = e.id;
  if it.id is null then return null; end if;
  return quizbox_mock.listing_json(it) || jsonb_build_object('sales', (select count(*) from public.mk_purchases p where p.item_id = it.id and p.status = 'active'));
end $fn$;

create or replace function public.qb_mock_listing_submit(p_exam uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.sellable(p_exam, true); it public.mk_items; v_stale integer;
begin
  select * into it from public.mk_items where mock_exam_id = e.id for update;
  if it.id is null then raise exception 'QB_MOCK_NOT_LISTED' using errcode = 'P0002'; end if;
  v_stale := quizbox_mock.stale(it.mock_version_id);
  if v_stale > 0 then raise exception 'QB_MOCK_VERSION_STALE: % question(s) changed or were withdrawn since the listed version was published', v_stale using errcode = '55000'; end if;
  perform public.qb_mk_item_submit(it.id);
  perform quizbox_core.audit('mock_exam.listing_submit', 'mock_exams', e.id, jsonb_build_object('item', it.id));
  select * into it from public.mk_items where id = it.id;
  return quizbox_mock.listing_json(it);
end $fn$;

create or replace function public.qb_mock_listing_unlist(p_exam uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true); it public.mk_items;
begin
  select * into it from public.mk_items where mock_exam_id = e.id;
  if it.id is null then raise exception 'QB_MOCK_NOT_LISTED' using errcode = 'P0002'; end if;
  perform public.qb_mk_item_unlist(it.id);
  select * into it from public.mk_items where id = it.id;
  return quizbox_mock.listing_json(it);
end $fn$;

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

commit;
