# Report failed answer saves (audit UX-023)

Lets the quiz page report a failed answer save to the operations log. It changes **one function** (`qb_operation_failure`): the list of operation names it accepts gets one more entry, `ATTEMPT_SAVE`. Nothing else changes: the caller must still be signed in, the budget of 20 reports a minute still applies, and only an upper-case error code is stored (never an answer or personal data).

Safe order: **Preview first, then production**. The website code can be deployed before or after this SQL: until it is applied, the database refuses the new name and the quiz page ignores that refusal.

## 1. Apply (Supabase, SQL editor, one paste)

Open the project, **SQL Editor**, new query, paste the whole of `supabase/migrations/20261047100000_attempt_save_failure_log.sql`, **Run**. Expected: "Success. No rows returned".
Preview project: `fngdtxayfoiffbcbmcum`. Production project: `fmgccmqxfjppqydkhaiu`.

## 2. Check it worked (read-only)

```sql
select p.prosrc like '%ATTEMPT_SAVE%' as accepts_attempt_save
from pg_proc p where p.proname = 'qb_operation_failure' and p.pronamespace = 'public'::regnamespace;
```
Expected: one row, `true`.

## 3. Look at the reports later (read-only)

```sql
select created_at, details->>'error_code' as error_code
from public.audit_logs where action = 'QB_OP_ATTEMPT_SAVE'
order by created_at desc limit 50;
```
A few rows a week is normal. A run of the same code means something is failing for students: open Admin, Platform operations.

## 4. Undo

Paste `supabase/rollback/attempt_save_failure_log.sql`. The quiz keeps working (it ignores the refusal); stored report rows stay.
