# Student Core: backend contracts still required

Both items were investigated against the existing RPCs and RLS. Neither can be built honestly in the frontend alone, so no UI was added.

## 1. Student-initiated practice (subject, strand, difficulty, count, Start)

Why it is blocked:
- Students cannot read `questions` (RLS returns no rows; answer columns are blocked) or write `assessments` / `assessment_questions`.
- The only builder of a PRACTICE assessment from a question pool is `qb_publish_assignment`, which requires a class and teacher authority (`qb_can_manage_class`).
- `qb_start_attempt(assessment_id, assignment_id, class_id)` starts only an existing assessment.

Smallest contract (one SECURITY DEFINER RPC, reusing existing tables and the existing player/results):

```
qb_start_self_practice(
  p_subject_code text,
  p_curriculum_node_id uuid default null,   -- strand / sub-strand / indicator
  p_difficulty text default null,
  p_question_count int default 5            -- clamp 3..20
) returns jsonb  -- { attempt_id, assessment_id }
```

Behaviour: select approved questions via the same predicate `qb_question_is_available` / `quizbox_market.question_allowed`
(market-enforced), snapshot them into a new `assessments` row (`assessment_type='PRACTICE'`, `owner_user_id=auth.uid()`,
visible only to its owner) plus `assessment_questions` snapshots, then call the existing `qb_start_attempt`. Return a clear
error when the pool is smaller than requested. Rate-limit with `quizbox_private.enforce_budget`. No schema change is needed
beyond the function; the frontend then only needs a form on `/practise` that calls it and routes to `/student/attempt/{attempt_id}`.

## 2. Progress hierarchy (Subject → Strand → Sub-strand)

`qb_student_insights` (`quizbox_ops.student_insights`) returns only `by_subject {subject, mastery, topics}` and
`weak_topics {topic, code, mastery}`. `mastery_records` is keyed by `curriculum_node_id` and holds `attempts_count`, so the
data exists. Required contract: extend the function output with, per mastery record, `node_type`, `parent_id`/ancestor
ids (strand, sub-strand titles and codes), `attempts_count`, and `mastery_score`, so the client can group without guessing.
The same `attempts_count` should replace `topics` as the evidence value passed to `masteryLevel(score, evidence)`.

## 3. Per-question curriculum context in the player

`qb_get_attempt` returns neither curriculum node nor strand per question, and `learning_events` rows are only written at
submit time. The player therefore shows Subject and Grade (from the already-listed assessment). Strand and indicator need
`qb_get_attempt` to include `curriculum_node` `{id, code, title, node_type, parent_titles[]}` on each question.
