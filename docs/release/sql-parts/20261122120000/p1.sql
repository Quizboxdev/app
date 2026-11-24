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
