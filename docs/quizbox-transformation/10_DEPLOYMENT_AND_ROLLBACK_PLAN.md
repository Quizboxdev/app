# 10. Deployment and rollback plan

Date: 2026-10-25. Applies to each release; the section for Release C-1 is concrete. Rules: database first, then code; Preview before Production; every database step has an undo; new commercial features ship **off** and are switched on by the owner in Admin after the acceptance gates pass. Nothing here executes a production change by itself.

## 1. Order of work for any release

1. Branch, tests green locally (`npx tsc --noEmit`, `npx eslint .`, `npx vitest run`).
2. `python scripts/release/make_release_kit.py` (regenerates paste-ready SQL parts, fingerprints and the file list).
3. Apply the SQL parts to **Preview** in the Supabase SQL editor, in order, then run fingerprint A and B (`docs/release/db_fingerprint_A.sql`, `_B.sql`): every row must say `ok`.
4. Same on **Production**.
5. Commit only the named files (`git --literal-pathspecs add --pathspec-from-file=scripts/release/release-files.txt`), push the branch, wait for CI, merge to `main` (Vercel deploys production).
6. Record the fingerprint result in `docs/release/FINGERPRINT_HISTORY.md`.
7. Switch the feature flag on only after the gates in §3.

## 2. Release C-1 (affiliates and commission ledger)

| Step | Where | What | Undo |
|---|---|---|---|
| 1 | Preview SQL editor | Paste `docs/release/sql-parts/20261048100000/p1.sql` … `p7.sql` in order | `supabase/rollback/affiliate_commission_foundation.sql` |
| 2 | Preview | Run `db_fingerprint_A.sql` and `db_fingerprint_B.sql`; all `ok` | n/a |
| 3 | Production SQL editor | Same parts, same order | same rollback |
| 4 | Production | Fingerprints again | n/a |
| 5 | Git | Commit the files listed in `scripts/release/release-files.txt`; push; CI; merge | `git revert` of the merge commit; Vercel instant rollback to the previous deployment |
| 6 | Vercel | Confirm production deployment READY; open `/r/TEST1234` (it should redirect to `/` and set a cookie), `/affiliate` (shows "not open yet" while the flag is off), `/admin/affiliates` (finance only) | n/a |

Compatibility: with the flag off and the migration applied, payments behave exactly as before (two extra RPC calls that answer `programme_off`). With the code deployed before the migration, payments behave exactly as before (the calls are skipped when the function is not found). With the migration rolled back, the same skip applies.

## 3. Gates before the owner switches the programme on in production

| Gate | Evidence required | Status |
|---|---|---|
| Migration on Preview and Production, fingerprints `ok` | pasted result | NOT RUN (owner action) |
| One approved commission policy version | `/admin/affiliates` Policy tab shows "In force", approver and date | NOT RUN |
| Paystack sandbox payment by a referred test customer → exactly one accrual | accrual row + ledger row | NOT RUN (no sandbox keys here) |
| Sandbox refund → exactly one reversal | reversal ledger row | NOT RUN |
| Finance reconciliation: ledger totals tie to accruals, no unexplained difference | `qb_commission_admin_summary` ties out; tested in database tests | PASS (tests) / NOT RUN (live) |
| Affiliate terms reviewed by counsel | written confirmation | NOT RUN |
| Tax treatment confirmed (decision F-1) | accountant note | NOT RUN |
| Monitoring: Paystack webhook failures and `[checkout]` logs watched for a week | none | NOT RUN |

To switch on: Admin → Affiliates → "Switch the programme on" (owner or super admin only; it needs an approved policy and a ticked confirmation). To switch off instantly: the same card, "Switch the programme off"; existing records stay; refunds still reverse commissions.

## 4. Rollback by layer

| Layer | Rollback | Data effect |
|---|---|---|
| Feature | flag off | none |
| Code | Vercel instant rollback / revert merge | none |
| Database functions | rollback script | functions removed; **all records kept** |
| Database records | never rolled back automatically (financial records); manual drop only before any real commission exists | n/a |

## 5. Backout of a bad commission (finance)

Use Admin → Affiliates → Commissions → "Reverse a commission" with the payment reference and a reason. This writes a reversal ledger row; it does not delete anything. Suspend the affiliate on the Applications tab if fraud is suspected.

## 6. Later releases

Each later release (B to H) adds a section here with its steps, its undo script and its gates before the matching flag may be switched on. Real-cash prizes, automated payouts and mass notifications are never part of a release without explicit written authorisation from the owner.
