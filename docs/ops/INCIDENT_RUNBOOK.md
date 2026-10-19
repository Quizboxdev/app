# QuizBox incident runbook

For the owner and support staff. Keep it short: find the section, do the steps in order, write down what you did.

## 0. Where to look first
| What | Where |
|---|---|
| Is the site up? | Open https://www.quizbox.io and sign in as a test learner. |
| Browser crashes, new enquiries, failed operations | Admin, Support (`/admin/support`) |
| Platform operations, audit trail, account lookup | Admin, Platform Operations (`/admin/operations`) |
| Deploys and build logs | Vercel dashboard, project quizbox, Deployments |
| Database health, logs, advisors | Supabase dashboard, project fmgccmqxfjppqydkhaiu: Logs, Reports, Advisors |
| Enquiries from the public | Admin, Enquiry Inbox (`/admin/inbox`) |

## 1. Site down or every page errors
1. Vercel, Deployments: is the latest deployment red? If so, open the previous green one and choose **Instant Rollback** (or Promote to Production). The site is back in about a minute.
2. If deployments are green, check Supabase status and project health. A paused or over-limit project returns errors on every sign-in and page.
3. If only the database is down, nothing in the app can be fixed from our side: tell users "QuizBox is being fixed" on any channel you use, and wait for Supabase.
4. Write down: time noticed, time fixed, what changed.

## 2. Crash spike (20 or more browser crashes in an hour)
1. Admin, Support: read the grouped list. The top row names the page and the error.
2. Did a deploy just go out? If yes, roll back (section 1, step 1) first, investigate second.
3. If one page: tell its users to use another route while the fix is built, and send the page name and message to the developer.
4. If one browser (for example an old Safari): ask affected users to update it.

## 3. Learners cannot sign in
1. Try signing in yourself. If password sign-in fails for everyone: check Supabase Auth logs and the status page.
2. For one user: Admin, Platform Operations, account lookup. Check the account is active. Reset the password from the sign-in page ("Forgot password").
3. A burst of sign-in failures from many addresses can be an attack. The sign-in failure log is rate limited per source; check Supabase Logs for the pattern, then follow section 5.

## 4. A learner sees a wrong question or answer
1. Do not edit the question. Note the subject, grade, topic and the question text.
2. Admin, Approve Batches: find the batch the question came from. If many questions look wrong, **Revoke** the batch: its questions go offline at once and return to review.
3. Send the examples to the content owner.

## 5. Suspected breach or data exposure
1. Do not delete anything: logs are evidence.
2. Rotate secrets that may be exposed: Supabase (Project Settings, API: roll the service-role key) and Vercel environment variables. Redeploy.
3. Force password resets if accounts may be affected (Supabase Auth, Users).
4. Record what was exposed, when, and how many people. Under Ghana's Data Protection Act, 2012 (Act 843) a personal data breach must be reported to the Data Protection Commission; ask counsel to confirm the exact notice period and form.
5. Tell affected users plainly what happened and what they should do.

## 6. Payment or subscription problem
1. Online payment is not live yet. Subscriptions are granted by hand at Admin, Access and Subscriptions. A wrong grant can be revoked there with a reason.
2. When payments go live, this section will list provider status pages and the reconciliation steps.

## 7. Bad deploy or bad database change
1. Code: Vercel Instant Rollback (section 1).
2. Database: every migration has a rollback file in `supabase/rollback/` with the same name. Run it in the SQL editor, then record what you did in `docs/roadmap/PROGRESS.md`.
3. Never run a rollback that drops a table holding real rows without exporting them first. The enquiry rollback refuses for this reason.

## 8. After every incident
Write three lines in `docs/ops/INCIDENT_LOG.md`: what happened, what fixed it, what stops it happening again. Update this runbook if a step was wrong.

## Contacts to fill in
| Role | Name | Phone | Email |
|---|---|---|---|
| Owner | Ransford Mensah | | |
| Developer on call | | | |
| Counsel (data protection) | | | |
| Supabase and Vercel support | via dashboards | | |
