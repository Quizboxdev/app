# More export datasets (migration 20261046100000)

Adds nine datasets to **Admin, Export data**, bringing the total to **31**. Apply this only AFTER `APPLY_EXPORTS.md` (migration 20261045100000), and do not re-run that earlier migration afterwards (it would put the list back to 22; if that happens, simply run the three parts below again).

| Group | New datasets | Who (besides the owner) |
|---|---|---|
| Competitions | Interschool competitions, Competition results | competition admins, admins |
| Competitions | Sponsors | admins |
| Schools and learning | Classes, Class results, Assignments, Notifications sent | admins |
| People and audit | Teachers, Learners | owner and super admin only |

Privacy: class join codes are never exported; competition and class results show teams and learners as an anonymous code; notification text is not exported (only type, title, recipient role and whether it was read); teacher-managed children are left out of Learners.

## Database (three parts)
Supabase SQL editor, project `fmgccmqxfjppqydkhaiu`. For each part: run the copy command in PowerShell, paste into a new query, Run, expect "Success". In order. Safe to run twice.

Part 1:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\exports\exm1.sql" -Raw | Set-Clipboard
```
Part 2:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\exports\exm2.sql" -Raw | Set-Clipboard
```
Part 3:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\exports\exm3.sql" -Raw | Set-Clipboard
```

Verify (builds one row of every dataset against your real tables; expect up to 31 rows, each with a number, and no error):
```sql
select d.key, d.need, (public.qb_export_build(d.key, null, null, null, 1) ->> 'total')::bigint as rows_available
from public.qb_export_defs() d where to_regclass(d.tbl) is not null order by d.grp, d.key;
```
If a dataset shows an error such as "column ... does not exist", paste it to me: those tables come from older code and may differ from what I read. Datasets whose table is not in your database are simply not offered.

Then open Admin, Export data and look for the new groups.

Rollback: `supabase/rollback/admin_exports_more.sql` puts the list back to 22.
