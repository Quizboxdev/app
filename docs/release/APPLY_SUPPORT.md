# Turning on support requests and the contact form with file upload (migration 20261038100000)

What changes:
- **Everyone signed in** gets **Support** in the top bar: send a request (with up to 3 screenshots or PDFs), follow it, reply. Staff replies show there and in the bell.
- **Visitors** use the contact page: the form now takes up to 3 files and gives a reference (for example QB-T-1A2B3C4D5E). General questions, account help and payments or refunds become tracked requests.
- **Staff** (owner, admin, super admin, support) get **Admin, Operations, Support requests**: a queue with filters, the conversation, answers, internal notes only staff see, status and priority, and delete (with the files) once resolved or closed.
Until you apply the database change, the contact form says "Sending is temporarily unavailable" and the Support pages show an error. Sponsor, school and subject-expert enquiries keep their own forms and the Enquiry Inbox.

## 1. Database (four parts, in this order)
Supabase, project `fmgccmqxfjppqydkhaiu`, SQL editor. For each part: run the copy command in PowerShell, paste into a new query, Run, expect "Success". Safe to run twice.

Part 1:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\support\support1.sql" -Raw | Set-Clipboard
```
Part 2:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\support\support2.sql" -Raw | Set-Clipboard
```
Part 3:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\support\support3.sql" -Raw | Set-Clipboard
```
Part 4:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\support\support4.sql" -Raw | Set-Clipboard
```
Verify (expect 14 rows, then 3 rows all true, then 1 row with public = false and 5242880):
```sql
select proname from pg_proc where pronamespace='public'::regnamespace and proname like 'qb_support%' order by 1;
select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname in ('support_requests','support_request_messages','support_request_files') order by 1;
select id, public, file_size_limit from storage.buckets where id = 'support-files';
```

## 2. Emails to the support team
New requests and replies are emailed to the **support email** in Admin, Policies, Company details (`support_email`). If it is empty, nobody is emailed (the requests are still in Admin, Support requests). Emails use the same `RESEND_API_KEY` and `EMAIL_FROM` already in Vercel.
- A signed-in person is emailed only "you have a reply, sign in to read it". A visitor, who has no account, is emailed the reply itself.

## 3. One edit in the Refund Policy draft
The Refund Policy version 1 draft still says "we will tell you how to send a screenshot when we reply". Uploads now exist. In Admin, Policies, Refund Policy, change step 3 of "How to ask" to:
`3. For a duplicate charge, include the evidence described above. You can attach screenshots or a statement to the contact form.`
(The built-in page text is already updated.)

## Rules built in
- A person sees only their own requests; the database checks every call. Staff see all.
- Files: PNG, JPEG, WebP or PDF only, 5 MB each, 3 at a time, 10 per request. The type is decided by what is inside the file, so a program renamed to .png is refused. Files are kept in a private bucket under random names and opened only through a 60-second link the server issues after checking who is asking.
- Limits: 10 new requests an hour per signed-in person, 30 replies an hour; visitors 5 an hour per device and 5 a day per email address; a hidden field and a minimum time on the page stop simple bots.
- A closed request cannot be answered by the person (they open a new one). A resolved request reopens if they reply.
- Internal notes are never shown to the person. Deleting a resolved or closed request removes its messages and files for good (this is how the retention period in the Privacy Notice is applied; there is no automatic deletion yet).
- The older `support_tickets` table is left alone.
- Rollback: `supabase/rollback/support_requests.sql` (files already stored are not removed by SQL; delete them in Supabase, Storage, support-files).
