# Database fingerprint history

Purpose: prove, on a schedule, that the **Production** (`fmgccmqxfjppqydkhaiu`) and **Preview** (`fngdtxayfoiffbcbmcum`) databases have the same migrations, and keep a dated record an auditor can read. The check is read-only: it changes nothing.
A GitHub issue is opened automatically on the 1st of every month (`.github/workflows/monthly-checks.yml`) as the reminder. Also run it after every migration is applied.

## The monthly routine (about 15 minutes)

1. Run part A and part B on **Production**, copy each result table into one text file, for example `fp-prod.txt`. Lazy way, from the project folder in PowerShell:
   ```powershell
   Get-Content -Raw -Encoding UTF8 docs\release\db_fingerprint_A.sql | Set-Clipboard    # paste in Production SQL editor, Run, copy the table
   Get-Content -Raw -Encoding UTF8 docs\release\db_fingerprint_B.sql | Set-Clipboard    # same again
   ```
   Paste both tables into `fp-prod.txt` (outside git; do not commit it). Repeat on **Preview** into `fp-prev.txt`.
2. Also run this on both projects and expect the same number (31 on 2026-10-24 Production): `select count(*) as datasets from public.qb_export_defs();`
3. Compare and record:
   ```powershell
   npx tsx scripts/release/compare-fingerprints.ts fp-prod.txt fp-prev.txt --record "monthly"
   ```
   It prints `IDENTICAL` or lists every difference, and appends a dated line below. Commit the new line (a one-line pull request is enough).
4. If it says NOT IDENTICAL: do not apply anything blindly. Send the output; the apply order and the safe re-run rules are in `docs/release/RELEASE_MANIFEST_2026-10-24.md`.

When a new migration is added, regenerate the check first (`python scripts/release/make_release_kit.py`) so the new migration is included.

## Record

| Date | Production | Preview | Result | Note |
|---|---|---|---|---|
| 2026-10-24 | 28/28 ok | 28/28 ok | identical | Migrations 20261020 to 20261047, parts A and B, after bringing Preview up to Production. Export datasets: Production 31; Preview showed 22 after 45 was re-run and 46 was re-run to restore 31 (confirm 31 at the next check) |
| 2026-10-31 | 29/29 ok | 29/29 ok | identical | Preview database rebuilt from a Production schema-only dump (218 tables, 596 functions, 172 policies, signup trigger, 4 storage buckets) plus 22 reference tables copied from Production (curriculum, settings, price list, policies, help articles). No people, payment or audit data. Preview has no cron job and no user accounts yet. |
