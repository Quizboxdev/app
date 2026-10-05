# School backend contracts

School admins (`institution_memberships.role` in `admin`/`owner`) read only through `qb_school(...)`. `gradebook`, `assignments`
and `class_memberships` policies stay teacher-owner / student-self; no policy or grant was changed.

## Implemented — `supabase/migrations/20261008100000_school_performance.sql` (NOT yet applied to any hosted project)

- `qb_school('performance')` → `quizbox_ops.school_performance(inst)` (SECURITY DEFINER helper, no client grant; `qb_school` authorises first).
  Scope: active classes of the one institution. Roster = active `class_memberships`. Score = each learner's latest FINAL `gradebook` row per class
  (same rule as Teacher analytics); school/grade figures are per unique learner, never an average of class averages.
  Returns `summary`, `by_grade`, `by_class`, `by_subject`, `weak_indicators` (≥5 responses, `low_evidence` when <5 learners or <20 responses).
  Scores are `null` (not 0) when nobody is assessed. `assignment_completion_rate` covers published assignments already past due only.
- `qb_school('overview')` adds `classes[].teacher_user_id` and `summary.{unique_learners, joined_last_30d}`.
- `qb_school('history')`: the `limit 200` was applied to the aggregate (capped nothing); it now caps the rows. The UI still treats the feed as capped.

The UI works before the migration is applied: performance falls back to a "not available yet" state and overview falls back to client counts.

## Remaining gaps

1. `qb_school('learners', {page,q,class_id})` returning `{membership_id, student_user_id, name, class_id, grade, status, joined_at}` — replaces the 200-row history for the Learners screen (history has no ids and shows only recent memberships).
2. `qb_school('class_members', {class_id})` — Classes → "Learners & transfers" reads `class_memberships` directly, which RLS blocks for admins who are not the class teacher.
3. Teacher workload/activity: `teachers[].active_assignments`, `last_active_at`; class `last_activity_at` (inactive-class signal).
4. Trends: no dated series is exposed, so no TrendChart. A weekly `average_score` series per grade would unlock it.
5. Subscription/plan/licence status: no data exists; not built.
