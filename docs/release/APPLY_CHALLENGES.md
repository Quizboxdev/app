# Apply: QuizBox Challenges (two migrations, eleven small parts)

Run in Supabase, project `fmgccmqxfjppqydkhaiu`, SQL editor, in this order. Each part is safe to run twice. For each: run the PowerShell line, paste into a new query, press Run, expect "Success".
If you already applied part1 to part5 earlier, skip them and start at ext1.

```
$d = "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\challenges"
Get-Content "$d\part1.sql" -Raw | Set-Clipboard
```
Change `part1` to part2, part3, part4, part5, then ext1, ext2, ext3, ext4, ext5, ext6 (same line, new file name each time).

Verify (expect 38 functions and 11 tables):
```sql
select count(*) as functions from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like '%challenge%';
select count(*) as tables from pg_tables where schemaname='public' and tablename like 'challenge%';
```
Rollback: `supabase/rollback/challenges_extensions.sql` (then re-run part1 to part5), or `supabase/rollback/challenges_foundation.sql` to remove everything. Both delete campaign data.
Parts were produced by `python scripts/release/split_migration.py <migration> docs/release/challenges <prefix>`.

## Moderation and notifications (third migration, three more parts)
Apply after the eleven parts above. Same method: run each line, paste into a new query, Run, expect "Success".
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\challenges\mod1.sql" -Raw | Set-Clipboard
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\challenges\mod2.sql" -Raw | Set-Clipboard
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\challenges\mod3.sql" -Raw | Set-Clipboard
```
Verify (expect 42 functions and 12 tables):
```sql
select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like '%challenge%') as functions,
       (select count(*) from pg_tables where schemaname='public' and tablename like 'challenge%') as tables;
```
Rollback: `supabase/rollback/challenges_moderation.sql`, then re-run part1 to part5 and ext1 to ext6.

## Young learners lifecycle (separate migration 20261024100000)
Overview of all schools, moving a leaving teacher's learners, and the (off by default) scheduled erasure switch.
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\lifecycle\life1.sql" -Raw | Set-Clipboard
```
(If a `life2.sql` exists, run it next the same way.) Verify (expect 6 rows):
```sql
select proname from pg_proc where pronamespace='public'::regnamespace and proname in
 ('qb_managed_overview','qb_managed_reassign','qb_managed_set_auto_erase','qb_managed_erasure_due','qb_managed_auto_erase_on','qb_managed_retention_months') order by 1;
```
To use the scheduled erase later: add `CRON_SECRET` (a random string of 16 or more characters) to the Vercel project, then switch it on in Admin, Young learners. Rollback: `supabase/rollback/managed_learner_lifecycle.sql`.
