# Release manifest, 2026-10-24: what goes to Preview and what goes to Production (main)

Written for: the owner, who applies everything by hand. Two separate things must reach both environments: the **code** (through git and Vercel) and the **database changes** (SQL pasted into Supabase). They are independent: deploy order below.

I cannot see either database from here. Everything marked "expected" is from the project history and must be confirmed with the read-only fingerprint (step 1). Nothing in this file has been applied.

> **Laziest path:** open `docs/release/COPY_LIST.ps1` in VS Code and work top to bottom, one line at a time (Shift+Enter on a line puts that SQL on your clipboard; paste into the named Supabase project and Run). Steps: 1 look at both databases, 2 Production gets the one new migration, 3 Preview catches up oldest first, 4 look again, 5 code (Preview, then main).

## 1. How the two databases are made identical

1. **Measure.** Run the fingerprint on **both** projects (read-only; it changes nothing):
   `.\scripts\release\Copy-Sql.ps1 -Fingerprint` copies part A, then part B. Paste each into Supabase, SQL Editor, Run, copy the result table.
2. **Compare** the `status` column row by row. `ok` = applied, `MISSING` = not applied, `PARTIAL` = stop and send me the row.
3. **Fill the gaps in version order**, Preview first: `.\scripts\release\Copy-Sql.ps1 -Migration 20261030100000,20261031100000` (list the MISSING versions in order). The script copies one part at a time and waits for you.
4. **Measure again.** Both projects must now show `ok` for every row. Identical tables = identical databases for everything from migration 20261020 onward.

Rules that protect you: never re-run a migration whose status is `ok`; never apply a later migration before an earlier MISSING one; `20261045` must never be run after `20261046` (it would put the export list back to 22 datasets); if a part errors, stop and send me the error text.

Earlier migrations (before 20261020) were reconciled between the two projects on 2026-10-06 (schema parity report) and 2026-10-19 (production parity). The fingerprint starts at 20261020 on purpose.

### Expected state (from the project history; confirm with the fingerprint)

| Migration | Production (expected) | Preview (expected) |
|---|---|---|
| 20261020 to 20261024 (erasure, challenges, lifecycle) | applied (confirmed live 2026-10-20/21) | applied (Preview migrated 2026-10-21) |
| 20261025 to 20261029 (push, dismiss, competitions, drafts, studio) | applied | **probably missing from 20261027 or 20261029**, check |
| 20261030 to 20261042 (price list, coin products, minimum charge, refunds, policies, support, help, seats) | applied | **probably missing** |
| 20261043, 20261044 (marketplace and its guides) | applied (the GHS 40 test purchase was delivered) | **probably missing** |
| 20261045, 20261046 (admin exports, 31 datasets) | applied (31 datasets checked against the live database) | **probably missing** |
| **20261047** (this release: failed-save reporting) | **not applied** | **not applied** |

So the likely result of step 1: **Production needs only 20261047. Preview needs everything the fingerprint marks MISSING, then 20261047.** Preview was where the hosted builds were already failing (branch-limited environment variables), which is a separate Vercel fix (see section 5).

## 2. Database changes in this release

| Version | Name | Send to | What it does | Undo |
|---|---|---|---|---|
| 20261047100000 | attempt_save_failure_log | **Preview, then Production** | `qb_operation_failure` accepts the operation name `ATTEMPT_SAVE`, so the quiz page can report a failed answer save. One function, explicit permissions (signed-in users only). | `.\scripts\release\Copy-Sql.ps1 -Rollback attempt_save_failure_log` |
| 20261030 to 20261046 (only where MISSING) | see `docs/release/sql-parts/index.json` | **Preview** (and Production only if its fingerprint says MISSING) | Already written, tested and, on Production, applied earlier | the matching file in `supabase/rollback/` where one exists |

All SQL is in `docs/release/sql-parts/<version>/p1.sql ...` (each part under 8,500 characters, cut only between statements). Rebuild after editing any migration: `python scripts/release/make_release_kit.py`. A test (`lib/core/release-kit.test.ts`) fails if the parts are stale.

## 3. Code changes in this release (git)

Send to **Preview first** (push a branch: Vercel builds a Preview with the Preview settings), test, then move **main** to the same commit (Production). The exact files are listed in `scripts/release/release-files.txt` (171 paths: 64 source, test and script files, 82 SQL parts, and the audit and release documents). Source files, by purpose:

| Purpose | Files |
|---|---|
| Accessibility and wayfinding | `app/not-found.tsx`; `app/login/page.tsx`; `app/auth/{callback,forgot-password,reset-password,update-password}/layout.tsx`; `app/onboarding/{layout,page}.tsx`; `components/AppShell.tsx` (page titles, skip link, offline banner); `components/DashboardHero.tsx`; `components/pricing/PricingCards.tsx` (+ `tones.test.ts`); `app/globals.css`; `app/(public)/public.css`; `lib/policies/render.tsx` (+ test), `components/help/HelpArticleView.tsx` (guide headings) |
| Offline, saving and errors | `components/ConnectionBanner.tsx`; `components/LoadError.tsx`; `lib/assessment/save-queue.ts` (+ test); `app/(app)/student/attempt/[id]/page.tsx`; `lib/api/assessment.ts`; `lib/errors.ts` (+ test); `lib/operations/safety.ts`; five pages now using `LoadError` (`teacher`, `sponsor`, `admin/support`, `admin/competitions`, `teacher/submissions/[attemptId]`) |
| Speed and caching | `middleware.ts` (+ test); `app/(public)/page.tsx`, `opening/page.tsx`, `contact/page.tsx`, `terms`, `privacy`, `refunds`, `cookies`, `help/[slug]`; `policy-version/[slug]/page.tsx`; `components/public/{ContactFormWithType,PublicHeader,HeroSection,FinalCta}.tsx` |
| Sharing | `app/opengraph-image.tsx`; `app/(public)/opengraph-image.tsx`; challenge and competition `[slug]/opengraph-image.tsx`; `lib/share/*`; `lib/site.ts`; `components/challenges/PublicDetail.tsx` |
| Database | `supabase/migrations/20261047100000_attempt_save_failure_log.sql`; `supabase/rollback/attempt_save_failure_log.sql` |
| Release tooling | `scripts/release/{Copy-Sql.ps1,make_release_kit.py,release-files.txt}`; `docs/release/db_fingerprint_{A,B}.sql`; `docs/release/sql-parts/**`; `lib/core/release-kit.test.ts`, `lib/core/operation-failure-list.test.ts` |

**Not in the release, on purpose:** the unrelated work in your folder (`Questions Bank/`, `Images/`, `scripts/question-bank/`, `reports/`, `scratch/`, the `.docx` and `.xlsx` files, `quizbox-expansion-plan-dESIGN.md`) and `docs/ux-audit/evidence/` (16 MB of screenshots). `git add .` would sweep all of that in: use the named-file list only. The Copy-Sql git block does this for you.

## 4. Order of operations

| Step | Where | What | Check |
|---|---|---|---|
| 1 | Preview and Production | Fingerprint A and B (read-only) | You have two result tables |
| 2 | Preview | Apply each MISSING migration in version order, ending with 20261047 | Fingerprint again: all `ok` |
| 3 | Preview | `Copy-Sql.ps1 -Git`, block 1: commit and push the branch | Vercel builds a Preview and it is **Ready** |
| 4 | Preview | Sweep the public pages and sign in with a working Preview test account (offline test, quiz save, titles, skip link) | The checks in `12_QA_REGRESSION_REPORT.md` |
| 5 | Production | Apply 20261047 (and anything the Production fingerprint marks MISSING) | Fingerprint: all `ok`, identical to Preview |
| 6 | Production | `Copy-Sql.ps1 -Git`, block 2: fast-forward main | Vercel production deployment **Ready** |
| 7 | Production | Check `https://www.quizbox.io`: titles, 404 page, `/terms?v=1`, a help guide, a share preview in WhatsApp | See `docs/ux-audit/14_IMPLEMENT_NOW.md` |

SQL can go before or after its code: the quiz page ignores a refused report. Do the database first so the first failed save is already recorded.

## 5. Settings (Vercel), not code

| Setting | Production | Preview |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` = `https://www.quizbox.io` | done by you | done by you |
| `QB_SERVER_GUARD` | leave **off** until a signed-in walkthrough on Preview | set `on` on Preview only to test it |
| New variables needed by this release | none | none |
| Preview Supabase and Paystack **test** keys for All Preview Branches | n/a | still open: see the audit fix list, step B |

## 6. What proves the databases match

The two fingerprint tables are the same, row for row. Keep both outputs with the release notes. If any row differs, send me both and do not apply anything else.
