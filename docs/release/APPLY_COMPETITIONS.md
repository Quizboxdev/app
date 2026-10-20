# Turning on Competitions, sharing and the free-allowance rule (migration 20261027100000)

The website is deployed. Until you apply this database change, the new buttons show an error and challenges behave as before.

## 0. Check first (one line)
In the Supabase SQL editor for project `fmgccmqxfjppqydkhaiu`:
```sql
select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('qb_access_free_limit','qb_has_subscription','challenge_start','qb_challenge_notify') order by 1;
```
Expect all four names. If `qb_access_free_limit` is missing, apply `docs/release/apply_study_and_managed.sql` or the access-gate migration first.

## 1. Apply five parts, in order
Each line copies one part to your clipboard. Paste into a new query, Run, expect "Success". Safe to run twice.
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\competitions\comp1.sql" -Raw | Set-Clipboard
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\competitions\comp2.sql" -Raw | Set-Clipboard
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\competitions\comp3.sql" -Raw | Set-Clipboard
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\competitions\comp4.sql" -Raw | Set-Clipboard
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\competitions\comp5.sql" -Raw | Set-Clipboard
```
Verify (expect 8 rows):
```sql
select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('challenge_set_audience','challenge_my_audiences','challenge_track_share','qb_challenge_cleared','qb_challenge_stage_rank','qb_challenge_in_audience','qb_free_sessions_used','qb_challenge_allowance_blocked') order by 1;
```

## 2. Switch the free allowance on (when you are ready)
Joining a challenge or competition counts one free session for a learner, the same pool as practice. Nothing is limited until you set the number: Admin, Access and Subscriptions, "Free practice sessions". Teachers, sponsors, subscribers and the person who made the challenge are never limited.

## What changed
- A Challenge is one timed round. A Competition has up to six rounds; a round can pass players on by a pass mark and by "top N go through" once the round closes.
- Anyone with an active account (learners included, not young learners) can create and share. Learners may create 5 a day, others 20.
- A teacher can aim one at a class, a school administrator at a whole school. Members are notified when it goes live; it is never listed publicly.
- Joining needs an account. A shared link survives sign-up: after confirming their email the person lands on the challenge.
- A learner's first join of each challenge or competition uses one free session; when the allowance is used up they are sent to Subscribe.
- Rollback: `supabase/rollback/competitions_and_sharing.sql`, then re-apply the earlier Challenges parts as its header says.
