# AGENTS.md: rules for every contributor, human or AI agent

Read this file at the start of every session. It applies to Claude, Codex and any other agent, and to people. If a task conflicts with it, stop and ask the owner.

QuizBox is a learning and assessment platform (Next.js 15, Supabase, Vercel, Paystack). It handles learners' data and payments, so changes are reviewed, tested and reversible.

## 1. One source of truth
- The only source of truth is **https://github.com/Quizboxdev/app**, branch `main`. What is on `main` is what Production runs.
- Work in a **clean clone** of that repository, never in a folder that also holds question banks, exports or scratch files. Content (question banks, design exports, source images) lives **outside** the repository.
- Each agent works in its **own git worktree** with its own branch, so two agents never share a working folder:
  `git worktree add -b <branch> <folder> origin/main`

## 2. Branches and pull requests
- `main` is **protected**. Nobody pushes to it, including the owner and agents. Every change reaches `main` through a pull request whose required check `check` is green, merged by the owner with **Squash and merge**.
- Branch names: `claude/<topic>`, `codex/<topic>`, `feature/<topic>`, `fix/<topic>`. One topic per branch, one pull request per branch, small enough to review.
- Start from a fresh `git fetch origin` and branch from `origin/main`. Before opening a pull request, check the open pull requests for the same files. If they overlap, say so in the description.
- Fill in the pull request template. State what changed, why, how it was tested, and what you did **not** verify.
- Never force-push a shared branch. Never merge your own pull request. Never delete another contributor's branch.

## 3. Checks that must pass before a pull request is opened
```
npm ci
npx tsc --noEmit
npx eslint .
npx vitest run
npm run build
```
CI runs the same checks plus a dependency audit. Show the results in the pull request. If a check fails for a reason unrelated to your change, say so; do not hide it or skip it.

## 4. What may and may not be committed
- Stage **explicit paths only**. Never `git add .` or `git add -A` in a folder that is not a clean clone.
- Never commit: `.env*` files, keys, tokens or passwords; question banks or other content data; zips, exports, screenshots or generated reports; scratch scripts; build output.
- Source code, tests, migrations, configuration, documentation and the images the site serves (`public/`) belong in the repository.
- If a secret is ever committed, tell the owner at once. Rewriting history is a separate, deliberate step.

## 5. Database changes
- Only as a new file `supabase/migrations/<timestamp>_<name>.sql` plus its rollback in `supabase/rollback/` and a test that runs on an isolated PostgreSQL (see `lib/core/*-sql.test.ts`).
- Migrations are additive and idempotent where possible. Regenerate the release kit with `python scripts/release/make_release_kit.py` and commit the result.
- **Never apply a migration** to Preview or Production. The owner does that, Preview first, then compares fingerprints (`docs/release/`).

## 6. New behaviour ships off
- New user-facing behaviour sits behind a default-off flag in `platform_settings` (key `flags.<name>`, boolean JSON). Existing behaviour must be unchanged when the flag is off, and a test must prove it.
- Business rules live in the database (functions with explicit permissions and row-level security). The browser is never trusted for money, access or review decisions.

## 7. Production and Preview are the owner's
- Agents do not change Vercel settings, environment variables, Supabase projects, GitHub settings or branch rules, and do not run anything against Production data.
- Preview deployments are created by pushing a branch. Production is deployed only by the owner merging a pull request.

## 8. Commits
- `type(scope): summary` in the imperative, for example `fix(practice): count only published questions`. Types: feat, fix, docs, test, refactor, chore, perf.
- Body: why, not only what. Agents add the `Co-Authored-By` line for themselves.
- Record decisions and blockers in the pull request and in `docs/` (for example `docs/roadmap/PROGRESS.md`, `docs/design/BLOCKERS.md`).

## 9. Honesty
- Report what you verified and what you did not. A passing test is not a passing screen: say whether you looked at it in a browser.
- Do not claim a change is deployed, applied or safe unless you checked.
- AI agents wrote a large share of this code under the owner's direction. The owner reviews and approves every merge. See `docs/DEVELOPMENT.md`.

## 10. Repository map
| Path | What it holds |
|---|---|
| `app/` | Next.js routes and API routes |
| `components/` | Shared UI components |
| `lib/` | Business logic, API wrappers and tests |
| `supabase/migrations`, `supabase/rollback` | Database changes and their reversals |
| `public/` | Images, fonts and static files the site serves |
| `config/` | Runtime configuration files |
| `docs/` | Decisions, release guides, audits and design notes |
| `scripts/` | Release, audit and tooling scripts (not part of the running site) |
| `.github/` | CI, Dependabot, CODEOWNERS and the pull request template |
