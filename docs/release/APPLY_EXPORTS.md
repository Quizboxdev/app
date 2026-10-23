# Data exports for the admin tools (migration 20261045100000)

What it does: **Admin, Export data** (and an **Export data** button at the top of each admin tool) lets staff pick a dataset, a date range and a category, see a preview and the number of matching rows, then download a **CSV** (opens in Excel or Google Sheets) or a real **Excel (.xlsx)** file. Excel files have real dates and numbers (so sorting, filters and pivot tables work), a filter row, and an "About" sheet recording the filters and when the file was made.

## What can be exported (22 datasets)
| Group | Datasets | Who (besides the owner) |
|---|---|---|
| Money | Payments, Subscriptions, Coin ledger, Refund cases | finance admin |
| Money | Price list | any admin |
| Marketplace | Sales (60/40 split, subject and school), Payouts, Teacher ledger | finance admin |
| Marketplace | Question sets, Sellers | admins, content admins |
| Reviewers | Earnings, Payout batches | finance admin |
| Reviewers | Review decisions | admins, content admins |
| Support and help | Support requests, Help guides | support agents, admins |
| Challenges | Challenges and competitions, Challenge results | competition admins, admins |
| Content | Question bank summary, Question loading batches | admins, content admins |
| People and audit | Accounts, Policy acceptances, Audit log | **owner and super admin only** |

Filters: each dataset has a date column (for example Payments by the day created, Sales by the day purchased) and a category (for example Payments by status, Support by topic, Challenges by type, Question bank by subject, Audit log by area). Dates are UTC days, both ends included.

## Privacy and safety built in
- Each person is offered only the datasets their role allows; the database checks it again on every export.
- **Teacher-managed children are left out** of Accounts and Policy acceptances.
- Challenge results show learners as an **anonymous code**, not by name or email.
- **Bank and mobile-money numbers are never exported** (Marketplace payouts show the transfer reference and amounts only), and sellers' phone numbers are not included.
- Every real download (more than a preview) is recorded in the **audit log** (who, which dataset, dates, category, row count). Previews are not.
- A file holds at most **50,000 rows** (the newest); the screen and the file's About sheet say when more matched, so you can export the rest in date ranges.
- CSV cells that start with `=`, `+`, `-` or `@` are neutralised so a spreadsheet cannot run them as formulas.
- The Export data pages and files are read-only: nothing is changed by exporting.

## 1. Database (six parts)
Supabase, project `fmgccmqxfjppqydkhaiu`, SQL editor. For each part: run the copy command in PowerShell, paste into a new query, Run, expect "Success". Run them in order. Safe to run twice. Nothing existing is changed.

Part 1:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\exports\ex1.sql" -Raw | Set-Clipboard
```
Part 2:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\exports\ex2.sql" -Raw | Set-Clipboard
```
Part 3:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\exports\ex3.sql" -Raw | Set-Clipboard
```
Part 4:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\exports\ex4.sql" -Raw | Set-Clipboard
```
Part 5:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\exports\ex5.sql" -Raw | Set-Clipboard
```
Part 6:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\exports\ex6.sql" -Raw | Set-Clipboard
```

**Verify.** Run this. It builds one row of every dataset that exists in your database, exactly as an export would, so it also confirms every column name matches your real tables:
```sql
select d.key, d.need, (public.qb_export_build(d.key, null, null, null, 1) ->> 'total')::bigint as rows_available
from public.qb_export_defs() d where to_regclass(d.tbl) is not null order by d.grp, d.key;
```
Expect one row per dataset (up to 22) with a number in `rows_available`. If any dataset shows an error such as "column ... does not exist", paste me the message: it means that table differs from what I read in the code, and I will correct that one dataset. Datasets whose table is not in your database yet are simply not offered.

## 2. Try it
1. Sign in as the owner, open **Admin, Export data**.
2. Choose **Payments**, preset **Last 30 days**, category **successful**. The count and a preview of the newest rows appear.
3. Press **Download Excel**. Open it: the Data sheet has dates, numbers and a filter row; the About sheet shows the filters.
4. Press **Download CSV** and open it in Excel: accents and dates read correctly.
5. Open **Admin, Marketplace** and press **Export this data** on each tab (question sets, sellers, payouts, sales).
6. Check **Audit log** in the export list: you will see your own two downloads recorded as `export.run`.
7. Sign in as a finance admin and confirm they see the money datasets but not Accounts or Audit log.

Rollback: `supabase/rollback/admin_exports.sql` removes the export functions. Nothing else is touched.

## Not included yet
Competitions and sponsor workspace tables, class and learner progress reports, and notifications. Tell me which ones you need and I will add them the same way.
