# Turning on the Help centre (migrations 20261039100000 and 20261040100000)

What changes:
- **Help** in the top bar for everyone signed in (inside the app, at `/guides`) and **Help** in the website footer (`/help`, with a page for each guide, in the sitemap). Search answers as you type and looks inside the steps, not only the titles. A person's own guides come first (learner, teacher, school, sponsor); administrator workflows are not part of Help.
- **23 guides**, written from the screens as they are today: getting started (learner, teacher, school), practice, joining a class with a code, creating a class and sending the code, adding young learners, creating and doing an assignment, joining, creating and sharing a challenge or competition, reading the material, unfinished work, subscribe and Coins, refunds, password reset, results and progress, notifications, support requests, sponsoring a challenge, safety and privacy.
- Every guide ends with **"Was this helpful?"** (counted once per device per hour) and **"Still stuck?"**, which opens a support request that already knows which guide the person was reading.
- A small "How does this work?" link at the top of the main screens (Practise, Classes, Assignments, Young learners, Assignments for learners, Subscribe, Unfinished work, the quiz creator) and a "New here? Start with these guides" card on each home page (it can be hidden).
- Learners also get **Subscribe** under Me in the menu.
- **Admin, Operations, Help guides**: write, preview, publish, unpublish and delete guides, with read counts and helpful votes. Support staff (owner, admin, super admin, support) manage them.
Until you apply the database change, Help shows "The guides are not available right now" and everything else works as before.

## 1. Database, part A: the Help centre (two parts)
Supabase, project `fmgccmqxfjppqydkhaiu`, SQL editor. For each part: run the copy command in PowerShell, paste into a new query, Run, expect "Success". Safe to run twice. (Managing guides in Admin needs the support requests change, `docs/release/APPLY_SUPPORT.md`, applied first; reading guides does not.)

Part A1:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\help\help1.sql" -Raw | Set-Clipboard
```
Part A2:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\help\help2.sql" -Raw | Set-Clipboard
```
Verify (expect 9 rows, then 1 row with true):
```sql
select proname from pg_proc where pronamespace='public'::regnamespace and proname like 'qb_help%' order by 1;
select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname = 'help_articles';
```

## 2. Database, part B: the 23 guides (five parts)
Part B1:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\help\hseed1.sql" -Raw | Set-Clipboard
```
Part B2:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\help\hseed2.sql" -Raw | Set-Clipboard
```
Part B3:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\help\hseed3.sql" -Raw | Set-Clipboard
```
Part B4:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\help\hseed4.sql" -Raw | Set-Clipboard
```
Part B5:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\help\hseed5.sql" -Raw | Set-Clipboard
```
Verify (expect 23 rows, all `published`):
```sql
select category, slug, state, array_to_string(audiences, ',') as audiences from public.help_articles order by category, sort_order;
```

## 3. Check it, then make it yours
1. Open `/help` on the website, and Help inside the app. Search for "class code", "refund", "password".
2. **Read the guides you will point people to.** They were written from the screens in the code, not from a signed-in walk-through, so walk through each one once as a learner, a teacher and a sponsor, and correct anything that is off in Admin, Help guides (edit, then Save). Your beta testers can use the guides as the script.
3. Add more guides there at any time. Use the pattern `[words](help:web-name)` to link one guide to another.
4. The Privacy Notice, Terms and Refund Policy are linked from the guides. They show a notice until you publish them (Admin, Policies).

## Rules built in
- Anyone can read published guides and search them; only support staff can write. A draft is never visible. Switching a guide back to draft removes it from Help at once.
- Audiences are only learners, teachers, schools, sponsors and everyone. An administrator audience is refused by the database.
- A guide that is edited in Admin is never overwritten by re-running the guide script.
- Counters are written by the server only, one view or vote per guide per device per hour; no personal data is stored.
- Rollback: `supabase/rollback/help_centre.sql` (removes the guides and the table; export any edits first).
