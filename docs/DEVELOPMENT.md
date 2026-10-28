# How QuizBox is developed and released

This page describes the real process, including its limits. It is written for reviewers (for example an investor's technical adviser) and for new contributors.

## How the code is produced
- The product owner directs the work and approves every merge.
- A large share of the implementation is written by AI coding agents (Claude and Codex) working under the rules in `AGENTS.md`. Commits made by an agent carry a `Co-Authored-By` line.
- Commits made from the owner's machine may show the owner as author even when an agent wrote the change. The pull request history, CI results and review notes are the record of what was checked, not the author field.

## Environments
| | Production | Preview |
|---|---|---|
| Code | `main` | any pushed branch or pull request |
| Hosting | Vercel project `quizbox` (www.quizbox.io) | Vercel preview deployment per branch |
| Database | Production Supabase project | separate Preview Supabase project (a data-cloned branch) |
| Who changes it | the owner, by merging a pull request | anyone, by pushing a branch |

## Change flow
1. Branch from `origin/main` and make one small change.
2. Run typecheck, lint, tests and build locally.
3. Push the branch. Vercel builds a Preview automatically.
4. Open a pull request. CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests, build and a dependency audit. The required check is `check`.
5. The owner reviews and squash-merges. `main` is protected: direct pushes, force pushes and deletions are blocked for everyone.
6. Vercel deploys `main` to Production.

## Database changes
- Written as a migration with a rollback and a test on an isolated PostgreSQL.
- Applied by the owner, Preview first and then Production, using pre-split SQL parts (`docs/release/sql-parts/`).
- Verified with schema fingerprints A and B on both databases (`docs/release/db_fingerprint_*.sql`, history in `docs/release/FINGERPRINT_HISTORY.md`).

## Features and rollback
- New behaviour is behind a default-off flag in `platform_settings`. Switching a flag off restores the previous behaviour. Production can also be rolled back by promoting the previous Vercel deployment.

## Testing
- About 1,550 automated tests: unit tests, route tests with a fake database, and database tests that run the real migrations on an isolated PostgreSQL.
- Security-sensitive areas (payments, access, partner API, affiliates) have dedicated tests, including negative cases.

## Known limits (stated plainly)
- There are no browser end-to-end tests for signed-in screens. Those screens are checked by hand on Preview.
- Database migrations are applied by hand from the SQL editor, not by a migration tool. Environment parity is checked with fingerprints.
- One person reviews every change. A second reviewer is the next step as the team grows (`.github/CODEOWNERS`).
- Production and Preview environment variables are not identical (some scheduled-job, e-mail and push settings exist only in Production).
