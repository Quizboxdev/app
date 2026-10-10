# Question loading engine: design

Owner decisions, 2026-10-10: keep it simple; one injection system for every kind of question; **admin-only loading**; questions are loaded against an **academically approved curriculum**; the **sponsor workflow is never direct**: sponsors request, admins run the process. Tracker: docs/roadmap/PROGRESS.md tracks L (loading) and S (sponsor process).

## Principles
1. **One engine, one template.** `docs/question-loading/QuizBox_Question_Load_Template.xlsx` (and `.csv`) is the only format. The two prompts in PROMPTS.md (a generator for any source, and a batch check) make an AI produce it.
2. **Admin only.** Loading needs content-admin or super-admin rights (the existing `quizbox_factory.can_manage()` check). Sponsors, teachers and learners never see the loader.
3. **No approved scope, no load.** Every batch names its scope, and the database refuses a batch without one:
   - **Curriculum bank:** a market and an active curriculum approved for it (Primary / JHS / SHS). The `indicator_code` links each question to the curriculum.
   - **Sponsor request:** a document the admin has first registered and approved as a source (rights confirmed) for that request.
4. **The code decides, labels are checked.** For curriculum rows the indicator code decides grade, subject and strand; the `level`, `grade`, `subject` columns are only checked against it.
5. **Preview before load, never publish on load.** The check report lists every problem; accepted rows enter review; nothing reaches learners or sponsors until accepted.
6. **Truthful provenance.** AI-drafted questions stay recorded as such; learners see "Reviewed by subject experts".

## The loading screen (Admin → Content → Load questions)
1. **Scope:** Curriculum bank (market → curriculum) or Sponsor request (pick the request; its approved document is the scope).
2. **File:** upload `.xlsx` (sheet QUESTIONS) or `.csv`.
3. **Check report:** rows per level / grade / subject / indicator / difficulty; every row problem with its row number; quality flags (templated or repeated explanations, repeated stem patterns, off-topic options, duplicates, uneven answer letters, several defensible answers); download the problem list.
4. **Load into review:** tracked batches of up to 500 rows, with batch id, file name and hash, who, when, counts. Loading the same file twice is blocked.
5. **Route to the SME review pool** (below). Every loaded question is reviewed by one SME; the batch is complete when each question has a decision.

## The sponsor process (controlled)
```
Sponsor                                Admin
-------                                -----
Submits a request (who we are,         Verifies the sponsor, confirms content rights
goals, audience, dates, document)  ->  Registers the document as an approved source
                                       Makes the question pool with the generator prompt (offline)
                                       Loads it through the same loader (scope = this request)
                                       SME verifies the batch  -> pool READY
                                       Sets up the competition from the pool (rules, dates, eligibility)
Gets "ready for sign-off" notice   <-  
Signs off                          ->  Publishes
Follows status and results         <-  Competition runs; results reach the sponsor dashboard
```
Request states: SUBMITTED, IN_REVIEW, SOURCE_APPROVED, POOL_LOADING, POOL_VERIFIED, COMPETITION_CONFIGURED, SIGNED_OFF, LIVE, COMPLETED, plus REJECTED and CANCELLED. The sponsor is notified at each stage change (existing notifications table and bell).

## Topics: how teachers use the questions (track T)
Teachers teach topics and concepts, so the bank is organised that way:
- **A topic** is a unit taught in one to three lessons, named in teacher language, attached to one curriculum indicator. A topic has a block of **50 different questions** (15 easy, 20 medium, 15 hard), each tagged with one **concept** (3 to 8 concepts per topic, each with at least 3 questions).
- **Explanations teach.** Working through a topic's questions, with instant feedback, should leave a learner who missed the lesson understanding more than half of its concepts.
- **Assign one topic** to a class or to selected students, including absent ones, in study mode (easy to hard).
- **Assign several topics:** the teacher ticks topics under a subject and chooses a total; the system spreads the questions evenly (50 from 5 topics = 10 each, the remainder shared fairly), draws each topic's share across the difficulty levels and never repeats a question. If a topic cannot supply its share the assignment is blocked with a clear message.
- **Understanding** is measured per concept: a concept counts as understood after two correct answers, including one at medium or hard difficulty; topic understanding is understood concepts divided by the topic's concepts.
Existing code: `qb_publish_assignment` currently picks at random across all chosen curriculum nodes. The topic registry (T1) and the even-spread selection (T3) are the changes.

## SME review pool, ownership and pay (track R)
```
Loaded batch --> REVIEW POOL --> SME clicks "Pick" --> question is theirs --> decision (approve / reject / revise)
                 (questions in           (1 or N,          (one open reviewer      |
                  'review' state,         capped per day)   per question)          v
                  grouped by subject,                                       earning recorded at the fee in
                  grade, market,                                            their compensation plan
                  or "Sponsor")                                             (pending QA -> payable -> paid)
```
- **Who can pick:** an SME whose profile has an active domain for the question's subject / grade / market (`can_review`), or the SPONSOR domain for sponsor-pool questions. Admins grant these domains.
- **Ownership:** a pick creates the existing review assignment, so only one SME holds a question at a time. An unfinished pick can be returned (no pay) or is returned automatically after N hours.
- **Pay:** the fee comes from the SME's compensation policy, pinned at pick time. Enter it per question; the screen shows the "per 100 reviews" figure and a daily total (for example 0.10 each = 10 for 100 reviews).
- **Tracking:** completed reviews are recorded with time taken; the SME and the admin see counts and earnings per day, split into pending QA, payable and paid.
- **Quality:** senior QA samples each SME's reviews; a reversed review earns nothing; known-bad "seed" questions and a minimum review time catch rubber-stamping.

## What already exists and is reused
- Admin import RPC `qb_content_factory_import` (market and curriculum checks, indicator matching, source-document gate, review state, provenance, 500-row limit).
- `public.questions` with `content_origin` (CURRICULUM / SPONSOR_DOCUMENT / HYBRID) and `origin_metadata`, which can hold a sponsor pool question without a curriculum node.
- Source registry and approval (rights attestation), SME review events, notifications, the competition engine (drafts, snapshots, attempts, results).

## What is new (small)
- A reader for `.xlsx` and `.csv` in the template shape, with validation and quality flags (pure code, fully testable without a database).
- A load-batch record (file hash, scope, counts, report, status) and the batch-acceptance step.
- A sponsor request record with the states above, plus the admin queue and the sponsor status page.
- Admin setup of a competition from a verified pool, using the existing competition engine.

## Build order (least dependencies first)
1. **L3 loader core** (pure code and tests). No database needed.
2. **L4–L5 admin screen and batch tracking** on the existing import RPC; trial on Preview once a curriculum is active (D6).
3. **L6 batch acceptance**, then **L7 provenance labels**.
4. **S1–S2 sponsor request and admin queue**, then **S3–S4 sponsor-scope loading and verification** (same loader).
5. **S5–S7 competition setup, notifications, sign-off**, after the competition engine's acceptance work (F3, F7).

## Open points
- **Settled 2026-10-10:** every question is reviewed by an SME picked from the pool; senior QA samples SME work. No batch-level sample acceptance.
- **S7:** sponsor sign-off before go-live is recommended (it protects both sides).
- Subject and grade codes are inconsistent in production data (`Mathematics` vs `COMPUTING`, `B10` vs `SHS1`); the loader needs one clean picker list (L9).
