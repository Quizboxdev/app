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
