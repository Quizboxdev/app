# Turning on drafts for unfinished work (migration 20261028100000)

Forms for a challenge, a competition, a sponsored competition, a practice set and a topic assignment now save what has been typed as the person goes. Leave by mistake, come back, and it is restored. Each draft is deleted 24 hours after its last change (72 hours at most), with a warning two hours before: on screen, in the bell and on the phone, and by email once email is set up. Until you apply the database change, the forms work as before and nothing is saved.

## 1. Database (one part)
Supabase, project `fmgccmqxfjppqydkhaiu`, SQL editor. Copy it, paste into a new query, Run, expect "Success". Safe to run twice.
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\drafts\draft1.sql" -Raw | Set-Clipboard
```
Verify (expect 8 rows):
```sql
select proname from pg_proc where pronamespace='public'::regnamespace and proname like 'qb_draft%' order by 1;
```

## 2. The clean-up runs by itself
The five-minute push sender you already set up (`qb-push`) also deletes expired drafts and sends the two-hour warnings. Nothing to schedule. (If push is ever off, schedule `https://www.quizbox.io/api/cron/drafts` the same way with the same `CRON_SECRET`.)

## 3. Email (optional, an owner decision)
The in-app and phone warnings work without it. For the email, create an account with an email sender (the code uses Resend, https://resend.com), verify the quizbox.io domain there, then add two settings in Vercel (Production) and redeploy:
| Name | Value |
|---|---|
| `RESEND_API_KEY` | the key (mark Sensitive) |
| `EMAIL_FROM` | for example `QuizBox <no-reply@quizbox.io>` |

Without them the sweep simply skips the email.

## Rules
- 24 hours after the last change; any change restarts it; never more than 72 hours from the first save. "Keep 24 more hours" on the Unfinished work page does the same.
- One draft per kind and place, at most 20 per person, at most 100 KB each. Young learners (managed accounts) never get drafts.
- Finishing the work (publishing, creating, starting the practice) deletes its draft at once.
- Rollback: `supabase/rollback/activity_drafts.sql` (it deletes the drafts, which are temporary by design).
