# Repeat-weekly assignments and due-soon reminders

Migration `20261067100000_repeat_assignments.sql`. It ships **off**: the new screens and the runner do nothing until the flag below is set to `true`. Apply to **Preview first**, check, then Production.

## What it does
- A teacher, on **Assign by subject and topic**, can tick "Send a fresh copy of this to the class every week" and choose a weekday, a time (Ghana time) and how many days learners have. This assignment goes out now; the first repeat is the next matching weekday and time at least a day away.
- Every repeat is published through the existing publisher **as that teacher**, with fresh questions from the same subjects and topics. Results, gradebook, targets and the "New assignment" notification are the same as for a hand-made assignment.
- A week that cannot go out (a topic is short, the teacher no longer has the class) is skipped and the teacher is told in the bell; three skips in a row pause it. If the runner was down for more than a day, the missed week is not sent late.
- A teacher can keep 5 repeating assignments going. Pause, resume and stop are on **Teacher, Assignments, Repeating assignments** (`/teacher/assignments/repeating`).
- Learners get **one** in-app reminder (bell, and phone push if they enabled it) when an assignment is due within 24 hours and they have not handed it in. Nothing is emailed, so the Resend daily cap is not used, and learners without an email (young learners) are covered the same way.

## Apply (Preview, then Production)
1. Supabase SQL editor, paste the three parts in `docs/release/sql-parts/20261067100000/` (`p1.sql`, `p2.sql`, then `p3.sql`). Safe to run again.
2. It needs the five-minute sender already described in `APPLY_PUSH.md` (`CRON_SECRET`, the VAPID keys and the `qb-push` schedule). The weekly runner and the reminders ride that same run; there is no second schedule. Without it, nothing is published or sent.
3. When you are ready to test, turn the flag on (the owner runs this; Preview first):
```sql
update public.platform_settings set value = 'true'::jsonb where key = 'flags.repeat_assignments' and scope_type = 'global';
```
4. Check on Preview: as the Preview teacher, publish a by-topic assignment with Repeat ticked; open Repeating assignments; to see a run without waiting a week, run in SQL `update public.assignment_schedules set next_run_at = now() - interval '1 minute';` and wait for the next five-minute tick (or call the route yourself with the bearer token). Expect a new assignment for the class and a bell message for the teacher.

## Turn it off or undo
- Off: set the same setting to `'false'`. Schedules stay saved but nothing runs and the Repeat option disappears.
- Undo: `supabase/rollback/repeat_assignments.sql` (drops the schedules, the reminder log and the flag row; assignments already sent stay).

## Limits (by design)
- Whole class only, not selected learners.
- Repeats are drawn fresh each week from the same topics; with a small bank the same question can come round again.
- Ghana time (Africa/Accra) only.
