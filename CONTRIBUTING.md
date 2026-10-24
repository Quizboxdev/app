# Contributing and supporting QuizBox

For developers and support staff. Keep changes small, tested and reversible.

## The working rules

1. **Never work on `main` directly.** Make a branch (`fix/...`, `feature/...`, `release/...`), open a pull request, wait for CI to go green, get a review.
2. **One purpose per pull request.** A fix and an unrelated tidy-up are two pull requests.
3. **Every change has a test** that fails without it. Business rules (money, permissions, scoring) are tested at the database level; screens are tested through their logic modules in `lib/`.
4. **Use the named-file list for releases** (`scripts/release/release-files.txt`), never `git add .`: the working folder can contain unrelated files (question banks, spreadsheets, screenshots).
5. **Secrets never go in git, logs, screenshots or chat.** Keys live in Vercel and Supabase. `.env.*` files are ignored by git.

## Needs the owner's written approval before merging

Prices and payments; refunds and payouts; who can see or do what (permissions, row-level security, the sign-in guard); any database migration; anything about learners under 13; legal text.

## Making a change

```powershell
git checkout -b fix/short-name
# edit, then
npx tsc --noEmit ; npx eslint . ; npx vitest run
git add <the files you changed>      # by name
git commit -m "What changed and why (register item, if any)"
git push -u origin fix/short-name    # then open the pull request on GitHub
```

## Database changes

Migrations live in `supabase/migrations/` and are applied by hand, in order, first to **Preview**, then to **Production**.
For each migration: (1) write an undo script in `supabase/rollback/`; (2) run `python scripts/release/make_release_kit.py` (it rebuilds the paste-ready parts and the fingerprint; a test fails if you forget); (3) apply with `docs/release/COPY_LIST.ps1`; (4) run the read-only fingerprint on both projects and confirm every row says `ok`. Record the result in `docs/release/FINGERPRINT_HISTORY.md`.
Rules for SQL: functions that run with elevated rights must set `search_path`, every new function states its grants, and a migration is never edited after it has been applied: write a new one.

## Support staff: where to look first

| Question | Where |
|---|---|
| A learner paid but has no access | Admin, Payment checks (`docs/release/PAYMENT_CHECKS.md`) |
| Something is slow or erroring | Admin, Platform operations; `docs/ops/INCIDENT_RUNBOOK.md` |
| A support request | Admin, Support requests |
| What a screen is for | `docs/ux-audit/02_SCREEN_AND_ROUTE_INVENTORY.md`, the Help guides in Admin |
| Is Preview the same as Production? | the database fingerprint (`docs/release/`) |

## Style

TypeScript strict; no `any` in new code (use the types in `lib/types.ts` and `lib/api/*`); small functions; comments explain **why**, not what; plain-language user messages (add new error codes to `lib/errors.ts`); one name per concept as in `docs/ux/GLOSSARY.md`.
