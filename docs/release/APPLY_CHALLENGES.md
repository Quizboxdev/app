# Apply: QuizBox Challenges (migration 20261021100000)

Run in Supabase, project `fmgccmqxfjppqydkhaiu`, SQL editor. Five small parts, in order. Each is safe to run twice.
Each step: run the PowerShell line (copies the part to the clipboard), paste it into a new query, press Run, expect "Success".

```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\challenges\part1.sql" -Raw | Set-Clipboard
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\challenges\part2.sql" -Raw | Set-Clipboard
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\challenges\part3.sql" -Raw | Set-Clipboard
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\challenges\part4.sql" -Raw | Set-Clipboard
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\challenges\part5.sql" -Raw | Set-Clipboard
```

Verify (expect 21 functions, 5 tables):
```sql
select count(*) as functions from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (proname like 'challenge\_%' or proname like 'qb\_challenge\_%');
select count(*) as tables from pg_tables where schemaname='public' and tablename like 'challenge\_%';
```
Rollback: `supabase/rollback/challenges_foundation.sql` (deletes every campaign and attempt).
