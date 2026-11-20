# Scheduled loader (Preview only)

`scripts/question-bank/auto-load.ts` loads the staged question files into the **Preview** database one hourly session after another, and approves each batch when a rule check of its random sample passes. It needs no one at the keyboard and is meant to be started every hour by the Windows Task Scheduler.

## What it does, in order, for each file in the load plan
1. Skips files already finished (state is kept in `auto-load.state.json` next to the plan, and the database recognises a file by its content hash).
2. Checks the file exactly as Admin > Load questions does (curriculum codes, sources, loader rules). A file the loader refuses is logged as SKIPPED with the first reason, and the loop goes on.
3. Loads it into review in requests of 250 rows, paced under the database limits. The database allows 30 import requests per clock hour (about 7,500 rows). When the allowance is used up the run stops (`--once`, the scheduler starts the next one) or waits for the next hour (`-Stay`).
4. Draws the same random sample of 20 that the approval screen shows and runs `reviewSample` (`lib/question-loading/auto-review.ts`) on it: missing or unmatched answer, empty or duplicate options, a filler ending stuck on the wrong options only, a question that contains its own answer, a repeated question, the right answer nearly always the longest option, one answer letter nearly always right, and the share of the batch that passes the database checks.
5. Runs the same per-question rules over **every row of the file** (a sample of 20 misses a file that is 1 to 2% bad), plus a cut-off check (an option that ends on "of", "the", "and"...) and a fixed-length check (nearly all options the same 14 to 16 words means padding and cuts). A file with more than 1% flagged rows, or fixed-length options, is held for a person. Flagged rows of an approved file are listed in `auto-load-flagged-rows.csv` so they can be retired or repaired.
6. If every rule passes it approves the batch with basis `SCRIPT_CHECKED` and a note built from the real result. If a rule fails, the batch stays in review for a person and the reasons are logged.

## What the approval means (and does not)
No person reads the sample, and the rules cannot tell whether a marked answer is true. So the approval is recorded as a different kind (migration `20261118100000`): the questions carry `human_reviewed = false`, `approval_basis = SCRIPT_CHECKED` and a note that says no person read the sample and no subject expert reviewed it. Admin > Question batches shows "Checked by a script, not read by a person" under such an approval. Revoke works as for any batch (one click, whole batch). Nothing outside the owner-batch functions can approve without a human review.

## Safety
- Preview only: the project address is fixed in the script and a plan with another environment is refused.
- It signs in as a Preview super admin with `QB_ADMIN_EMAIL` / `QB_ADMIN_PASSWORD` and the Preview public key `QB_PREVIEW_ANON_KEY` (set by `dev\fp\auto_load_preview.ps1` from `auto-load.env`, outside the repo).
- If the database does not have the migration, it stops. It never falls back to an owner approval.
- One loop at a time (lock file). Stop it with the file `auto-load.STOP` next to the plan, or Ctrl+C; a file that was loading continues from where the database says it stopped.
- `--dry-run` signs in, reads every file and says what would happen, writing nothing.

## Files it writes next to the plan
`auto-load.log` (every action), `auto-load.state.json` (per file: batch, approval, note), `auto-load-progress.csv` (the same, for a spreadsheet), `auto-load.lock`.
