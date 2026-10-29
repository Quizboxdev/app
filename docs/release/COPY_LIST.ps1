# QuizBox copy list. One line = one paste. Made by scripts/release/make_copy_list.py; do not edit by hand.
# How: in VS Code put the cursor on a line, press Shift+Enter (runs it in the terminal). The text is now on your clipboard.
#      Then Supabase > the project named in the step > SQL Editor > New query > Ctrl+V > Run. Expected: Success (no red error).
# Work top to bottom. Production is the reference (main); Preview is brought up to match it. If any Run shows a red error: STOP and send me the error text.
# The paths below are relative: first run this once in the terminal (adjust if your folder differs):
Set-Location "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment"

# =====================================================================================================
# STEP 1. LOOK (read-only, changes nothing). Run both lines on PRODUCTION, then both on PREVIEW. Keep the result tables.
# =====================================================================================================
# 1a. PRODUCTION  (project fmgccmqxfjppqydkhaiu, the one behind main / www.quizbox.io)
Get-Content -Raw -Encoding UTF8 docs\release\db_fingerprint_A.sql | Set-Clipboard      # paste in PRODUCTION, Run, copy the table
Get-Content -Raw -Encoding UTF8 docs\release\db_fingerprint_B.sql | Set-Clipboard      # paste in PRODUCTION, Run, copy the table
# 1b. PREVIEW  (project fngdtxayfoiffbcbmcum)
Get-Content -Raw -Encoding UTF8 docs\release\db_fingerprint_A.sql | Set-Clipboard      # paste in PREVIEW, Run, copy the table
Get-Content -Raw -Encoding UTF8 docs\release\db_fingerprint_B.sql | Set-Clipboard      # paste in PREVIEW, Run, copy the table
# Send me the four tables. I will tell you in one line which of steps 2 and 3 to skip. (Rows that say ok are already applied: skip them.)

# =====================================================================================================
# STEP 2. PRODUCTION: the only new migration in this release
# =====================================================================================================
# PRODUCTION  (project fmgccmqxfjppqydkhaiu, the one behind main / www.quizbox.io)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261047100000\p1.sql | Set-Clipboard      # 20261047100000 attempt_save_failure_log  part 1 of 1
# Check (read-only), same project:
Set-Clipboard -Value "select p.prosrc like '%ATTEMPT_SAVE%' as accepts_attempt_save from pg_proc p where p.proname = 'qb_operation_failure' and p.pronamespace = 'public'::regnamespace;"      # expect one row: true

# =====================================================================================================
# STEP 3. PREVIEW: bring it up to match Production, oldest first. SKIP every migration whose fingerprint row said ok on Preview.
# Never apply a later one before an earlier MISSING one. Never run a migration twice.
# =====================================================================================================
# PREVIEW  (project fngdtxayfoiffbcbmcum)
# ---- 20261020100000  managed_learner_erasure  (1 part)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261020100000\p1.sql | Set-Clipboard      # part 1 of 1
# ---- 20261021100000  challenges_foundation  (4 parts)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261021100000\p1.sql | Set-Clipboard      # part 1 of 4
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261021100000\p2.sql | Set-Clipboard      # part 2 of 4
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261021100000\p3.sql | Set-Clipboard      # part 3 of 4
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261021100000\p4.sql | Set-Clipboard      # part 4 of 4
# ---- 20261022100000  challenges_extensions  (6 parts)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261022100000\p1.sql | Set-Clipboard      # part 1 of 6
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261022100000\p2.sql | Set-Clipboard      # part 2 of 6
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261022100000\p3.sql | Set-Clipboard      # part 3 of 6
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261022100000\p4.sql | Set-Clipboard      # part 4 of 6
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261022100000\p5.sql | Set-Clipboard      # part 5 of 6
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261022100000\p6.sql | Set-Clipboard      # part 6 of 6
# ---- 20261023100000  challenges_moderation  (3 parts)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261023100000\p1.sql | Set-Clipboard      # part 1 of 3
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261023100000\p2.sql | Set-Clipboard      # part 2 of 3
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261023100000\p3.sql | Set-Clipboard      # part 3 of 3
# ---- 20261024100000  managed_learner_lifecycle  (2 parts)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261024100000\p1.sql | Set-Clipboard      # part 1 of 2
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261024100000\p2.sql | Set-Clipboard      # part 2 of 2
# ---- 20261025100000  push_notifications  (1 part)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261025100000\p1.sql | Set-Clipboard      # part 1 of 1
# ---- 20261026100000  notification_dismiss  (1 part)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261026100000\p1.sql | Set-Clipboard      # part 1 of 1
# ---- 20261027100000  competitions_and_sharing  (5 parts)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261027100000\p1.sql | Set-Clipboard      # part 1 of 5
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261027100000\p2.sql | Set-Clipboard      # part 2 of 5
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261027100000\p3.sql | Set-Clipboard      # part 3 of 5
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261027100000\p4.sql | Set-Clipboard      # part 4 of 5
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261027100000\p5.sql | Set-Clipboard      # part 5 of 5
# ---- 20261028100000  activity_drafts  (1 part)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261028100000\p1.sql | Set-Clipboard      # part 1 of 1
# ---- 20261029100000  quiz_studio  (5 parts)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261029100000\p1.sql | Set-Clipboard      # part 1 of 5
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261029100000\p2.sql | Set-Clipboard      # part 2 of 5
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261029100000\p3.sql | Set-Clipboard      # part 3 of 5
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261029100000\p4.sql | Set-Clipboard      # part 4 of 5
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261029100000\p5.sql | Set-Clipboard      # part 5 of 5
# ---- 20261030100000  price_list  (2 parts)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261030100000\p1.sql | Set-Clipboard      # part 1 of 2
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261030100000\p2.sql | Set-Clipboard      # part 2 of 2
# ---- 20261031100000  coin_products  (2 parts)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261031100000\p1.sql | Set-Clipboard      # part 1 of 2
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261031100000\p2.sql | Set-Clipboard      # part 2 of 2
# ---- 20261032100000  minimum_charge  (1 part)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261032100000\p1.sql | Set-Clipboard      # part 1 of 1
# ---- 20261033100000  drop_stale_practice_overloads  (1 part)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261033100000\p1.sql | Set-Clipboard      # part 1 of 1
# ---- 20261034100000  student_academic_limits  (2 parts)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261034100000\p1.sql | Set-Clipboard      # part 1 of 2
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261034100000\p2.sql | Set-Clipboard      # part 2 of 2
# ---- 20261035100000  refund_cases  (3 parts)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261035100000\p1.sql | Set-Clipboard      # part 1 of 3
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261035100000\p2.sql | Set-Clipboard      # part 2 of 3
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261035100000\p3.sql | Set-Clipboard      # part 3 of 3
# ---- 20261036100000  policy_cms  (3 parts)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261036100000\p1.sql | Set-Clipboard      # part 1 of 3
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261036100000\p2.sql | Set-Clipboard      # part 2 of 3
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261036100000\p3.sql | Set-Clipboard      # part 3 of 3
# ---- 20261037100000  policy_seed_v1  (3 parts)
#      NOTE: Seeds the 4 policy drafts; each is inserted only for a document that has no version yet, so running it again is safe and never overwrites an edit.
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261037100000\p1.sql | Set-Clipboard      # part 1 of 3
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261037100000\p2.sql | Set-Clipboard      # part 2 of 3
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261037100000\p3.sql | Set-Clipboard      # part 3 of 3
# ---- 20261038100000  support_requests  (4 parts)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261038100000\p1.sql | Set-Clipboard      # part 1 of 4
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261038100000\p2.sql | Set-Clipboard      # part 2 of 4
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261038100000\p3.sql | Set-Clipboard      # part 3 of 4
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261038100000\p4.sql | Set-Clipboard      # part 4 of 4
# ---- 20261039100000  help_centre  (2 parts)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261039100000\p1.sql | Set-Clipboard      # part 1 of 2
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261039100000\p2.sql | Set-Clipboard      # part 2 of 2
# ---- 20261040100000  help_seed_v1  (5 parts)
#      NOTE: Guide seed; each row says 'on conflict do nothing', so a second run keeps edits (a deleted guide would come back).
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261040100000\p1.sql | Set-Clipboard      # part 1 of 5
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261040100000\p2.sql | Set-Clipboard      # part 2 of 5
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261040100000\p3.sql | Set-Clipboard      # part 3 of 5
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261040100000\p4.sql | Set-Clipboard      # part 4 of 5
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261040100000\p5.sql | Set-Clipboard      # part 5 of 5
# ---- 20261041100000  challenge_seats  (2 parts)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261041100000\p1.sql | Set-Clipboard      # part 1 of 2
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261041100000\p2.sql | Set-Clipboard      # part 2 of 2
# ---- 20261042100000  help_seats_guide  (1 part)
#      NOTE: Guide seed, 'on conflict do nothing'.
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261042100000\p1.sql | Set-Clipboard      # part 1 of 1
# ---- 20261043100000  marketplace  (9 parts)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261043100000\p1.sql | Set-Clipboard      # part 1 of 9
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261043100000\p2.sql | Set-Clipboard      # part 2 of 9
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261043100000\p3.sql | Set-Clipboard      # part 3 of 9
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261043100000\p4.sql | Set-Clipboard      # part 4 of 9
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261043100000\p5.sql | Set-Clipboard      # part 5 of 9
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261043100000\p6.sql | Set-Clipboard      # part 6 of 9
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261043100000\p7.sql | Set-Clipboard      # part 7 of 9
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261043100000\p8.sql | Set-Clipboard      # part 8 of 9
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261043100000\p9.sql | Set-Clipboard      # part 9 of 9
# ---- 20261044100000  help_marketplace_guides  (1 part)
#      NOTE: Guide seed, 'on conflict do nothing'.
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261044100000\p1.sql | Set-Clipboard      # part 1 of 1
# ---- 20261045100000  admin_exports  (6 parts)
#      NOTE: Do NOT run after 20261046100000: it would put the export list back to 22 datasets.
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261045100000\p1.sql | Set-Clipboard      # part 1 of 6
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261045100000\p2.sql | Set-Clipboard      # part 2 of 6
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261045100000\p3.sql | Set-Clipboard      # part 3 of 6
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261045100000\p4.sql | Set-Clipboard      # part 4 of 6
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261045100000\p5.sql | Set-Clipboard      # part 5 of 6
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261045100000\p6.sql | Set-Clipboard      # part 6 of 6
# ---- 20261046100000  admin_exports_more  (3 parts)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261046100000\p1.sql | Set-Clipboard      # part 1 of 3
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261046100000\p2.sql | Set-Clipboard      # part 2 of 3
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261046100000\p3.sql | Set-Clipboard      # part 3 of 3
# ---- 20261047100000  attempt_save_failure_log  (1 part)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261047100000\p1.sql | Set-Clipboard      # part 1 of 1

# =====================================================================================================
# STEP 4. PROVE THEY MATCH (read-only): run the four fingerprint lines from step 1 again. Every row must say ok on both projects.
# =====================================================================================================

# =====================================================================================================
# STEP 5. CODE. Only after step 4 is clean on Preview. These are PowerShell commands, so run each block in the terminal, not in Supabase.
# =====================================================================================================
# 5a. Preview first: branch, named files only, commit, push (Vercel builds a Preview). Wait until it says Ready and test it.
git checkout -b release/ux-and-resilience-2026-10-24
git --literal-pathspecs add --pathspec-from-file=scripts/release/release-files.txt
git status --short
git commit -m "UX audit fixes: accessibility, offline and save queue, caching, share cards, button system; release kit"
git push -u origin release/ux-and-resilience-2026-10-24
# 5b. Production (main), only when the Preview is good:
git fetch origin
git merge-base --is-ancestor origin/main HEAD; if ($?) { 'OK: main can be fast-forwarded' } else { 'STOP: main has moved on, do not push' }
git push origin release/ux-and-resilience-2026-10-24:main
# Undo for the database change, if ever needed (paste in Supabase):
Get-Content -Raw -Encoding UTF8 supabase\rollback\attempt_save_failure_log.sql | Set-Clipboard      # puts qb_operation_failure back as it was
