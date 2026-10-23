# Turning on Policies: Terms, Privacy, Refunds, Cookies (migrations 20261036100000 and 20261037100000)

Admin, then Operations, then **Policies** lets an owner or super admin write or upload each policy, preview it, and publish it. Visitors see the live version at `/terms`, `/privacy`, `/refunds` and `/cookies`. After sign-up, and after a real change, people read and accept the required ones (Terms and Privacy). Until you publish something, nothing changes for visitors: the pages keep their current notice and nobody is asked to accept anything.

## 1. Database, part A: the policy section (three parts, in this order)
Supabase, project `fmgccmqxfjppqydkhaiu`, SQL editor. For each part: run the copy command in PowerShell, paste into a new query, Run, expect "Success". Safe to run twice.

Part A1:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\policies\policy1.sql" -Raw | Set-Clipboard
```
Part A2:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\policies\policy2.sql" -Raw | Set-Clipboard
```
Part A3:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\policies\policy3.sql" -Raw | Set-Clipboard
```
Verify (expect 15 rows, then 4 rows, then 11 rows):
```sql
select proname from pg_proc where pronamespace='public'::regnamespace and (proname like 'qb_policy%' or proname like 'qb_company%') order by 1;
select slug, title, required from public.policy_documents order by sort_order;
select key from public.company_details order by sort_order;
```

## 2. Database, part B: the version 1 drafts (three parts, in this order)
Part B1:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\policies\seed1.sql" -Raw | Set-Clipboard
```
Part B2:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\policies\seed2.sql" -Raw | Set-Clipboard
```
Part B3:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\policies\seed3.sql" -Raw | Set-Clipboard
```
Verify (expect 4 rows, all `draft`, version 1):
```sql
select d.slug, v.version_no, v.state, length(v.body) as characters from public.policy_versions v join public.policy_documents d on d.id = v.document_id order by d.sort_order;
```

## 3. Publish (in Admin, no more SQL)
1. Open Admin, Policies. Under **Company details**, fill in every empty line: registration number, registered address, support email, data protection contact, Data Protection Commission number, where data is stored, and how long you keep tickets, inactive accounts and quiz attempts. Company name and country are already set.
2. Pick **Terms of Use**, read it through, change anything that is not true for QuizBox, use **Preview**, then **Publish**. Do the same for Privacy, Refunds and Cookies.
3. Publishing is refused while a company detail the text uses is empty, and the message says which one.
4. As soon as the Terms and Privacy are live, every signed-in person is asked to read and accept them before using QuizBox. Teacher-managed child accounts are not stopped: the teacher's acceptance is recorded for them when the account is created.

## 4. Before you publish: read these drafts yourself
The drafts are written in plain language to follow the Ghana Data Protection Act, 2012 (Act 843), the principles of the GDPR and UK GDPR, and child-consent practice for under-13s. That is a drafting standard, not a certification, and not legal advice. **Have a lawyer qualified in Ghana review the Terms and the Privacy Notice before public launch.** In particular, confirm:
- the age rules (under 13 only through a teacher, school or with parent or guardian permission; consent age to be approved);
- the liability limit, governing law and the 30-day response time for data requests;
- that you really do not use advertising cookies, and that page-performance measurement is as described in the Cookie notice;
- the Refund Policy matches how you want to operate (it says nothing about a change of mind on a purchase that was applied and never used).
The Refund Policy says buyers should "tell us how to send a screenshot when we reply", because the contact form does not take file uploads yet. When uploads are live, publish a new version.

## Rules built in
- Only owners and super admins manage policies; everyone can read what is published; the database checks every call.
- A published version can never be edited or deleted. Changing a policy means a new version; the earlier versions stay readable on the page.
- "People must accept again" is for a real change. Leave it off for a typo; people are then not asked again.
- Each acceptance records who, which version, when, a fingerprint of the exact text, and who clicked (a teacher for a child account).
- Editing a company detail (for example the support email) updates every live policy at once, without a new version. A detail used by a live policy cannot be emptied.
- Rollback: `supabase/rollback/policy_seed_v1.sql` (removes the untouched version 1 drafts) and `supabase/rollback/policy_cms.sql` (removes the section; export `policy_acceptances` first if anyone has accepted).
