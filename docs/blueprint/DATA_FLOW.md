# Data flow: question creation to scoring (confirmed)

1. **Source.** A curriculum PDF or sponsor document is registered in `quizbox_sources.registry` or `competition.documents`. Approved sources are immutable (trigger `market_document_guard`).
2. **Structure.** A verified indicator CSV goes through `qb_curriculum_nodes_import` (super admin, level-guarded, idempotent) into `curriculum_nodes`, with one topic per indicator in the topic registry.
3. **Questions.** Written outside the app from the source (Gemini, ChatGPT or Codex) into a fixed file template, checked by `scripts/check-question-file.ts` (quote, page, balance and cue checks), staged, then loaded by the admin loader into `questions`.
4. **Review.** Questions route to the SME pool and a batch is complete when each question has a decision (D-10). **Not yet routed in production** (tracker L6).
5. **Retrieval.** `qb_practice_menu` lists topics that have approved questions. Assignments snapshot `assignment_question_versions`.
6. **Delivery.** `qb_start_attempt` and `qb_start_quick_practice` create `assessments` and `assessment_questions` snapshots (text, options, answer and marks frozen).
7. **Scoring.** `qb_complete_attempt` scores on the server from the snapshot; results and `learning_events` follow.

## Blueprint rules: where they hold
- Server-authoritative scoring and snapshots: yes, for education.
- Pre-validated pools, no live generation: yes (files, checker, review).
- Versioned content binding for rounds: education only (snapshots). Campaign content versions do not exist.
- Evidence retained per question: in loader files and audit CSVs, not in a question column. High-consequence campaigns (law, doctrine) need `source_evidence` on the row (blueprint 7.4). Gap.
