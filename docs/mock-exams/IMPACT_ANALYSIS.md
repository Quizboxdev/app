# Mock Exams: impact analysis, architecture map and plan

Written before any code, from the repository at `main` (commit d6c637f). "Fact" means read in the repository. "Assumption" means not confirmed by the repository.
Nothing here was run against Preview or Production.

## 1. What already exists (facts)

### Questions
- `public.questions` holds one row per question: `question_text`, `option_a..d`, `correct_answer` (A to D), `answer_type`, `answer_spec` (jsonb), `question_content` (jsonb), `marks`, `explanation`, `difficulty_code/difficulty_label`, `version`, `status`, `validation_status`, `text_hash`, `duplicate_group_id`, `source_type`, `source_version`, `curriculum_id`, `curriculum_node_id`, `canonical_grade_code` (initial schema `20260926180457_initial_quizbox_jhs_schema.sql`, columns added in `20261001160000_core_learning_engine.sql` and `20261002150000_question_factory_governance.sql`).
- Answer types the engine can mark: SINGLE_CHOICE, TRUE_FALSE, MULTIPLE_CHOICE, NUMERIC, FRACTION, SHORT_TEXT, EXPRESSION (`public.qb_grade_response`, `docs/release/engine/production_only_objects.sql`; validation in `qb_content_validation_errors`). The content generator only requests SINGLE_CHOICE and TRUE_FALSE (`core_qb_content_request_generation`).
- A question is "available" when `status = 'active'` and `validation_status = 'approved'`, tenant rules pass and its content validates (`qb_question_is_available`, `20261002150000`). The cheap check used for counting is `qb_question_is_listable` (`20261053100000_fast_subject_list.sql`).
- Editing a question's text, options, answer or marks bumps `version`, sets it to `review` and `inactive`, and stores the old version in `question_versions` (`qb_question_editorial_guard`, `20261002150000`). So a question that changed leaves every pool until it is approved again.
- Questions are tied to curriculum nodes (`curriculum_node_id`, indicator level) and to a registry topic through `question_topic_links`. `curriculum_topics` (one per indicator, `status ACTIVE/DRAFT/RETIRED`) is the registry (`20261012100000_topic_registry.sql`). Grade and subject of a topic come from its `curriculum_nodes` row (`canonical_grade_code`, `subject_code`).
- Duplicates: `questions.text_hash` and `duplicate_group_id` (`20261002150000`, `20261009100000`). The question loader rejects duplicates inside a market; nothing stops the same question appearing twice in one exam today because exams are built from one topic at a time.
- Helpers already used by the combined-test builder and reused here: `quizbox_topic.listable_questions`, `quizbox_topic.pick_for_topic` (difficulty split, one question per concept first, raises `QB_TOPIC_SHORT` instead of substituting), `quizbox_topic.ancestor_title`, `quizbox_topic.class_level` (all in `20261055100000_assessment_blueprint.sql` and `20261012140000_topic_assignment.sql`).

### Assessment, assignment, attempt, scoring
- `assessments` + `assessment_questions` (a frozen copy of each question: text, options, answer, marks, answer type, spec; filled by trigger `qb_snapshot_assessment_question` from the live row at insert time, and stamped with `question_version_snapshot` and `editorial_approved_snapshot`, `20261002161000`).
- `assignments` + `assignment_targets` publish an assessment to a class. The one publisher is `public.qb_publish_assignment` (`20261002120000_targeted_remediation_publish.sql`). Its MANUAL mode takes exact question ids; it caps a test at 100 questions; it stores `pass_percent = 40`.
- `qb_start_attempt` (`20261002170000`, wrapped by `20261009100000`) creates `attempts`; it enforces recipient access (`qb_can_access_learning_assessment`), opening and closing times, resume, `max_attempts`, and a time limit. `responses` hold the answer (`selected_answer`, `selected_value`), `is_correct`, `marks_awarded`. `core_qb_complete_attempt` scores on the server and writes `learning_events` and mastery.
- A private assessment with no assignment (practice) is allowed to any signed-in member of the public tenant who knows its id: `qb_can_access_learning_assessment` returns true when there is no assignment and `reference_type <> 'ASSIGNMENT'`. This matters for paid content (section 5).
- Teacher results today: `gradebook`, `qb_teacher_indicator_summary`, `app/(app)/teacher/gradebook`, `app/(app)/teacher/submissions/[attemptId]`. There is no per-exam student-by-question grid and no export of attempts.
- Combined multi-subject tests (Primary and JHS only, one grade, one section per subject, 1 to 100 questions) exist as `qb_blueprint_plan` / `qb_publish_blueprint_assignment` (`20261055100000`). They cannot span several grades, which is exactly what a cumulative mock needs.

### Roles
- `profiles.role` is TEACHER, STUDENT, SPONSOR, ADMIN, OWNER. Staff duties come from `user_capabilities` (`super_admin`, `content_admin`, `finance_admin`, `sme_support`). Teachers manage classes through `qb_can_manage_class`.
- Sponsors: `sponsor_profiles` with `sponsor_type` (ORGANIZATION, INDIVIDUAL, ALUMNI) and `verification_status` (PENDING, VERIFIED, REJECTED). Verification is shown, not enforced anywhere else (`20261121120000_sponsor_verification.sql`). The sponsor workspace is off in Production.
- Marketplace sellers are teachers only (`qb_mk_seller_save` raises `QB_TEACHERS_ONLY`); they must be verified by staff.

### Marketplace and payments (all fact, `20261043100000_marketplace.sql`, `app/api/marketplace/checkout/route.ts`, `lib/payments/settlement.ts`)
- `mk_sellers`, `mk_items` (draft, submitted, approved, rejected, unlisted; staff approve through `qb_mk_admin_review`), `mk_questions` (the set's own copy, shown with answers to a buyer), `mk_purchases` (price, 60/40 split, 90-day expiry copied in), `mk_ledger`, `mk_payouts`.
- Settings: `flags.marketplace`, `marketplace.seller_share_percent` 60, `hold_days` 7, `access_days` 90, `min_price_minor` 500, `max_price_minor` 20000, `min_questions` 10, `max_questions` 200.
- Purchase path: `/api/marketplace/checkout` prices the cart from the database (`qb_mk_prepare_purchase`: not your own set, not a minor, not already owned), creates a payment intent with a ten-minute idempotency key, records the cart on it (`qb_mk_set_payment_item`), and sends the buyer to Paystack. The webhook settles it and calls `qb_mk_fulfil_purchase` (idempotent: one `mk_purchases` row per payment reference, one ledger "sale" per purchase). A refund calls `qb_mk_reverse_purchase`, which marks the purchase `reversed` and takes the seller's share back.
- A set is bought for GHS 5 to GHS 200 in whole cedis, paid in coins through the Coins pipeline.
- What the Marketplace cannot do today: its sets are practice sets scored in the browser (`qb_mk_open` returns the answers to the buyer; `mk_attempts` stores only a total). It has no student-level records, no teacher results, no class delivery and no exam semantics.

### Exports
- `lib/exports/file.ts` builds CSV (BOM, CRLF, formula-injection guard on `= + - @ tab CR`) and XLSX (typed cells; text is written as strings; an About sheet). `app/api/admin/export/route.ts` is the pattern: the caller's own session calls a database function that checks the role, limits rows and writes an audit entry; the route formats the file. Admin export is limited to 50,000 rows.

### Delivery to students
- Class work appears in the student's assessments list and runs in `app/(app)/student/attempt/[id]`. Results are at `app/(app)/student/results`. Standalone assessments start with `startAttempt({ assessmentId })` (`lib/api/assessment.ts`).

### Process rules (AGENTS.md)
- New behaviour ships off behind `flags.<name>` in `platform_settings`, with a test that existing behaviour is unchanged. Migrations are additive, have a rollback and a PGlite test, and are never applied by an agent. The release kit is regenerated.

## 2. Gaps (nothing below exists)
1. A mock exam: cumulative selection across grades, topics and counts, with a running tally.
2. Immutable published versions of an exam.
3. A per-exam results view and student-by-question review for the teacher.
4. CSV and XLSX export of attempt data.
5. A way to sell an exam (not just a question set) and gate delivery on a verified purchase.
6. A WAEC (BECE or WASSCE) syllabus mapping. No table or file in the repository maps WAEC syllabus topics to curriculum nodes. "BECE readiness" is therefore only a label on the exam's purpose.
7. Question availability above Class 4 to JHS 1: depends on loading. The builder reads live counts and shows a shortfall; it never invents content.

## 3. Architecture map

```
Author (teacher | verified organisation sponsor | staff)         flags.mock_exams
  |  /mock-exams  /mock-exams/[id]        lib/api/mock-exams.ts  ->  qb_mock_* RPCs (security definer, owner checked)
  v
mock_exams (draft state)  -- mock_exam_rounds (grade, subject, topic, requested)
        |                      mock_exam_questions (selected question per round)
        | publish  (all rounds filled, every question still available)
        v
mock_exam_versions (immutable)  -- mock_exam_version_questions (frozen copy + source refs)
        |                               |
        | assign to class               | list on Marketplace (teacher seller only)
        v                               v
 qb_publish_assignment (MANUAL)      mk_items (mock_exam_id, mock_version_id)  -> staff review -> approved
 -> assignments / assessments        /api/marketplace/checkout (unchanged) -> Paystack -> qb_mk_fulfil_purchase
 -> mock_exam_assignments            -> mk_purchases (mock_version_id, 90 days)
        |                               | trigger: enrolment + private assessment for the buyer
        v                               v
   student attempt  (qb_start_attempt, unchanged)  <-- attempts trigger refuses a MOCK_EXAM assessment without a live entitlement
        v
   attempts / responses (scored on the server, unchanged)
        v
 qb_mock_results / qb_mock_result_rows / qb_mock_export  -> /api/teacher/mock-exams/export (CSV, XLSX)
```

End-to-end data flow: author builds rounds -> system selects questions per round from approved, listable questions, never from another topic or level -> publish freezes version N -> class path creates an assignment from version N, marketplace path lists version N -> a learner starts (class membership, or an active purchase) -> the engine records the attempt -> the owner reads results and exports.

## 4. Decisions taken (safest choice, each can be changed)
| # | Decision | Why |
|---|---|---|
| D1 | One new flag `flags.mock_exams`, off. | AGENTS.md rule 6. |
| D2 | Authors: active teachers, ORGANIZATION sponsors whose verification is VERIFIED, and staff (admin or owner). | Sponsors verification now exists; parents, individuals and alumni are excluded. |
| D3 | Eligible levels: same stage (Primary B1-B6, JHS B7-B9, SHS1-SHS3) and not above the target year. | Matches the product examples (JHS 2 includes JHS 1; P6 includes P4 and P5). Crossing a stage is a product decision (Q2). |
| D4 | One round per topic. Questions are picked per round with the existing picker (difficulty 30/40/30, one per concept first). A short topic raises `QB_TOPIC_SHORT` and nothing is added. Authors can also tick questions by hand. | No silent substitution. |
| D5 | Duplicates: a question may appear once; a question whose `duplicate_group_id` (or text hash) is already in the exam is refused. | Reuses the loader's duplicate identity. |
| D6 | 5 to 100 questions per exam, at most 30 rounds. | 100 is the existing publisher cap. |
| D7 | Publishing freezes a version. Editing a published exam makes a draft change; republishing makes version N+1. Assignments and purchases keep their version. | Attempt interpretation must not change. |
| D8 | Class delivery reuses `qb_publish_assignment`, so scoring, late rules, attempts and results are the existing ones. Pass mark stays at the engine's 40. | No second assessment engine. |
| D9 | Marketplace delivery reuses `mk_items`, checkout, settlement, split and refund unchanged. The exam is an `mk_items` row with no `mk_questions`, so `qb_mk_open` returns no answers. | No parallel payment system. |
| D10 | Each purchase gets a private assessment built at purchase time, so the version bought is the version taken. If a question has changed since publishing, creation is refused (`QB_MOCK_VERSION_STALE`) until the author republishes. | The assessment snapshot trigger copies the live question. |
| D11 | An attempts trigger refuses any attempt on a MOCK_EXAM assessment without a live purchase. | `qb_can_access_learning_assessment` would otherwise let a refunded buyer start. |
| D12 | Authors see class students by name. Marketplace participants are shown as "Buyer 1, 2, ..." with no name, email or school. | Data minimisation; buyers are strangers. |
| D13 | A teacher's results include only attempts on assignments they own or manage. | Existing class ownership rules. |
| D14 | Question order is shuffled per buyer only when the exam says so. Option order is never shuffled. Class assignments use the publisher's fixed order. | Shuffling options would break the stored answer key for MULTIPLE_CHOICE and typed answers. |
| D15 | Export: CSV and XLSX, at most 50,000 answer rows, audit-logged. Student answers are plain text, formula-guarded. | Same as admin export. |
| D16 | Refund ends new attempts. An attempt already in progress may finish. Results are kept. | The engine has no "kill attempt" path. |

## 5. Product and business decisions that the repository does not answer
Q1. **Sponsors selling and giving.** DECIDED 24 November 2026 (owner): a verified organisation sponsor can sell under the same Marketplace rules as a teacher (built). STILL OPEN: how a sponsor gives an exam to learners without selling it, since sponsors have no classes.
Q2. **Cross-stage cumulative exams** (for example a JHS 3 mock that revisits Primary 6). Allowed or not?
Q3. **Revenue split, tax and currency for exams.** The existing 60/40, GHS and whole-cedi rules apply because nothing else is defined. Do exams have a different split or price band? Is VAT or a withholding tax due?
Q4. **Retakes and sharing.** The purchase gives access for 90 days and as many attempts as the exam allows (default 1). Is a retake a new purchase? Access is per account; sharing is not prevented beyond that.
Q5. **Moderation.** Every listing is approved by staff (existing rule). Should staff also check mock exams against a WAEC syllabus first?
Q6. **WAEC mapping.** Not in the repository. Needs a source document and staff approval before "BECE readiness" can mean anything beyond a label.
Q7. **Refund policy for a partly taken exam.** Currently any refund ends new attempts.
Q8. **Minors.** Under existing rules a minor cannot pay (`QB_MINOR_CANNOT_PAY`). A parent must buy for a child, and no code links the parent's purchase to the child's account.
Q9. **What a learner sees after submitting.** The existing result page rules apply. A stricter "no answers until the closing date" rule for exams is not built.
Q10. **Pass mark.** Fixed at the engine's 40 for assignments.

## 6. Plan (as built)
1. Migration `20261122100000_mock_exams_authoring.sql`: flag, tables, authoring and publishing RPCs.
2. Migration `20261122110000_mock_exams_delivery.sql`: class assignment, results, row-level review, export dataset.
3. Migration `20261122120000_mock_exams_marketplace.sql`: listing, entitlement, enrolment, start, attempt guard.
4. App: `lib/api/mock-exams.ts`, pure logic in `lib/mock-exams/`, pages under `app/(app)/mock-exams`, an export route, marketplace buyer screens, navigation and the flag.
5. Tests: PGlite SQL tests for each migration, unit tests for the pure logic, the export route and the navigation guard.
6. Documentation: this file and `docs/mock-exams/HANDOFF.md`.

## 7. Risks and how they are handled
- The real engine (`qb_publish_assignment`, `qb_start_attempt`, the snapshot trigger) cannot be run here. The SQL tests use stand-ins for those objects, so the integration with the real engine is unproven until the owner applies the migrations to Preview and runs the checklist in `HANDOFF.md`.
- The attempts trigger adds one lookup to every attempt insert. It returns at once for any assessment that is not `MOCK_EXAM`.
- `qb_mk_item_questions_set` and `qb_mk_item_save` still work on a mock listing; a guard trigger stops anyone attaching questions to it.
- Backward compatibility: all changes are additive (new tables, new functions, nullable columns, new triggers that do nothing for existing rows). The rollback removes them in reverse order.
