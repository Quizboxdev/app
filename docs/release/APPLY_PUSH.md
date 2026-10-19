# Turning on push notifications

The code is deployed. Push stays invisible (the "Notifications on this device" switch does not appear) until you do these four things. The offline page, the faster loading and the "Install QuizBox" card work already and need nothing from you.

## 1. Database (one part)
Supabase, project `fmgccmqxfjppqydkhaiu`, SQL editor. Run this line in PowerShell, paste into a new query, Run, expect "Success". Safe to run twice.
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\push\push1.sql" -Raw | Set-Clipboard
```
Verify (expect 6 rows):
```sql
select proname from pg_proc where pronamespace='public'::regnamespace and proname like 'qb_push_%' order by 1;
```

## 2. Make a pair of push keys (on your PC, never in chat)
In PowerShell, in the repository folder:
```
npx web-push generate-vapid-keys
```
It prints a Public Key and a Private Key. Keep the private one secret.

## 3. Add four settings in Vercel (project `quizbox`, Settings, Environment Variables, Production)
| Name | Value |
|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | the Public Key |
| `VAPID_PRIVATE_KEY` | the Private Key (mark as Sensitive) |
| `VAPID_SUBJECT` | `mailto:` plus a support email you read, for example `mailto:support@quizbox.io` |
| `CRON_SECRET` | a random string of 16 or more characters (also used by the weekly young-learners erase job) |

Then redeploy (Deployments, the latest one, Redeploy). The public key is baked into the site at build time, so it must be redeployed after adding it.

## 4. Run the sender every few minutes
Vercel's free plan only allows one scheduled run a day, so use Supabase instead. In the SQL editor, replace `PUT-YOUR-CRON-SECRET-HERE` with the same `CRON_SECRET` and run:
```sql
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.schedule('qb-push', '*/5 * * * *', $job$
  select net.http_get(url := 'https://www.quizbox.io/api/cron/push', headers := jsonb_build_object('Authorization', 'Bearer PUT-YOUR-CRON-SECRET-HERE'));
$job$);
```
To stop it later: `select cron.unschedule('qb-push');`. (On a paid Vercel plan you could add the same route to `vercel.json` instead.)

## Check it works
1. Sign in on an Android phone with Chrome, open Account, press **Turn on** and allow notifications.
2. Cause a notification (for example, end a challenge you own that has a winner, or ask me to send a test).
3. Within about 5 minutes the phone shows it. Tapping it opens the right page.

## What push does and does not do
- Sends the same short messages already shown in the app bell, only for unread ones from the last 2 days.
- Never goes to young learners' accounts (the database refuses them).
- On iPhone it works only after the learner adds QuizBox to the Home Screen (iOS 16.4 or later).
- Turning it off removes that phone. Phones that stop responding are removed automatically.
- Rollback: `supabase/rollback/push_notifications.sql`.
