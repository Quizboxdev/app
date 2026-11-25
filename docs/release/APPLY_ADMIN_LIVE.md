# Admin live figures: how to apply (migration 20261125100000)

The new dashboard code works before and after the database change. Until the change is applied it uses the old `qb_admin_dashboard` call.

Apply to Preview first, then Production. Do not apply while questions are being loaded: building the index holds back writes to the questions table for a moment.

## 1. Measure first (read-only, run each on its own in the SQL editor)

How long the old call has been taking:

```sql
select calls, round(mean_exec_time) as mean_ms, round(max_exec_time) as max_ms from extensions.pg_stat_statements where query ilike '%qb_admin_dashboard%' order by max_exec_time desc limit 5;
```

How the question counts are read today (look at "Execution Time" and "Buffers"):

```sql
explain (analyze, buffers) select grade::text, count(*) filter (where status::text = 'active' and validation_status = 'approved') from public.questions group by grade;
```

Calls that were cancelled for taking too long are not counted by the first query. Look for them in Logs, Postgres, searching for "statement timeout".

## 2. Apply

Paste `docs/release/sql-parts/20261125100000/p1.sql`, then `p2.sql`, then `p3.sql`.

Then run this on its own, so the counts can be read from the new index alone:

```sql
vacuum (analyze) public.questions;
```

## 3. Check

```sql
select quizbox_stats.refresh_all();
```

```sql
select section, took_ms, computed_at from quizbox_stats.snapshots order by section;
```

A count that shows a dash on the dashboard means that table or column is not on this database. This lists them:

```sql
select key as count_not_available from quizbox_stats.snapshots, jsonb_each(payload) where section = 'queues' and value->>'n' is null;
```

## 4. Optional: refresh every minute without a visitor

Turn on the `pg_cron` extension (Database, Extensions), then paste `p3.sql` again. Without it the figures are calculated when someone opens the dashboard.

## Rollback

`supabase/rollback/admin_live_stats.sql`. The dashboard then uses the old call again. No business data is touched.
