# QuizBox copy list for the AFFILIATES release (migration 20261048100000). One line = one paste.
# How: open this file in VS Code, put the cursor on a line, press Shift+Enter (runs it in the terminal). The text is now on your clipboard.
#      Then Supabase > the project named in the step > SQL Editor > New query > Ctrl+V > Run. Expected: Success (no red error).
# Work top to bottom, in this order: PREVIEW database, PRODUCTION database, then the code (git), then the check. Never push the code before both databases are done.
# If any Run shows a red error: STOP and send me the error text. Do not run the next part.
# Nothing here switches the affiliate programme on: it stays OFF until you switch it on in Admin > Affiliates.
Set-Location "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment"

# =====================================================================================================
# STEP 0. Check you are in the right folder (should list 7 files p1.sql ... p7.sql)
# =====================================================================================================
Get-ChildItem docs\release\sql-parts\20261048100000 | Select-Object Name, Length

# =====================================================================================================
# STEP 1. PREVIEW  (project fngdtxayfoiffbcbmcum)  - paste each part, in order, into the Preview SQL editor
# =====================================================================================================
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261048100000\p1.sql | Set-Clipboard      # part 1 of 7  (settings, tables)
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261048100000\p2.sql | Set-Clipboard      # part 2 of 7
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261048100000\p3.sql | Set-Clipboard      # part 3 of 7
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261048100000\p4.sql | Set-Clipboard      # part 4 of 7
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261048100000\p5.sql | Set-Clipboard      # part 5 of 7
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261048100000\p6.sql | Set-Clipboard      # part 6 of 7
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261048100000\p7.sql | Set-Clipboard      # part 7 of 7  (permissions)
# 1-check (read-only, paste in PREVIEW, Run). Expect ONE row: policies = 1, v1_status = draft, flag_affiliates = false, functions = 22
Set-Clipboard -Value "select (select count(*) from public.commission_policies) as policies, (select status from public.commission_policies where version = 1) as v1_status, (select value from public.platform_settings where key = 'flags.affiliates' and scope_type = 'global') as flag_affiliates, (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'qb\_affiliate\_%' or proname like 'qb\_commission\_%' or proname like 'qb\_referral\_%' or proname like 'qb\_cm\_%')) as functions;"
# 1-fingerprint (read-only, paste in PREVIEW, Run each; every row must say ok)
Get-Content -Raw -Encoding UTF8 docs\release\db_fingerprint_A.sql | Set-Clipboard      # part A
Get-Content -Raw -Encoding UTF8 docs\release\db_fingerprint_B.sql | Set-Clipboard      # part B

# =====================================================================================================
# STEP 2. PRODUCTION  (project fmgccmqxfjppqydkhaiu, behind www.quizbox.io)  - ONLY after step 1 is all ok
# =====================================================================================================
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261048100000\p1.sql | Set-Clipboard      # part 1 of 7
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261048100000\p2.sql | Set-Clipboard      # part 2 of 7
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261048100000\p3.sql | Set-Clipboard      # part 3 of 7
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261048100000\p4.sql | Set-Clipboard      # part 4 of 7
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261048100000\p5.sql | Set-Clipboard      # part 5 of 7
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261048100000\p6.sql | Set-Clipboard      # part 6 of 7
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261048100000\p7.sql | Set-Clipboard      # part 7 of 7
# 2-check (read-only, paste in PRODUCTION, Run). Same expectation as 1-check
Set-Clipboard -Value "select (select count(*) from public.commission_policies) as policies, (select status from public.commission_policies where version = 1) as v1_status, (select value from public.platform_settings where key = 'flags.affiliates' and scope_type = 'global') as flag_affiliates, (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'qb\_affiliate\_%' or proname like 'qb\_commission\_%' or proname like 'qb\_referral\_%' or proname like 'qb\_cm\_%')) as functions;"
# 2-fingerprint (read-only, paste in PRODUCTION, Run each; every row must say ok)
Get-Content -Raw -Encoding UTF8 docs\release\db_fingerprint_A.sql | Set-Clipboard      # part A
Get-Content -Raw -Encoding UTF8 docs\release\db_fingerprint_B.sql | Set-Clipboard      # part B
# Send me the A and B tables from both projects. I will add them to docs/release/FINGERPRINT_HISTORY.md.

# =====================================================================================================
# STEP 3. CODE (git). Only after steps 1 and 2 are both ok. These run in the terminal, not in Supabase.
# =====================================================================================================
git status --short
git checkout -b feature/affiliate-commission-foundation
git --literal-pathspecs add --pathspec-from-file=scripts/release/release-files.txt
git status --short      # check: only the files named in scripts\release\release-files.txt are staged (green); nothing from "Questions Bank", Images, reports
git commit -m "Affiliates: commission policy, referral attribution, commission ledger, affiliate and finance screens; pricing Subscribe button; transformation docs"
git push -u origin feature/affiliate-commission-foundation
# Wait for the GitHub checks to go green on the branch. Then, to release to production (main):
git fetch origin
git merge-base --is-ancestor origin/main HEAD ; if ($?) { "ok: main is behind this branch" } else { "STOP: main has newer work. Send me this line." }
git push origin feature/affiliate-commission-foundation:main

# =====================================================================================================
# STEP 4. AFTER VERCEL SAYS READY (a few minutes). In the browser, signed out:
#   https://www.quizbox.io/r/TEST1234        -> goes to the home page (no error)
# Signed in as the owner:
#   https://www.quizbox.io/admin/affiliates  -> shows "Programme is OFF", a draft Pilot policy v1, no commissions
#   https://www.quizbox.io/affiliate         -> says the programme is not open yet
# Make a normal test payment check: Admin > Payment checks still says "All clear".
# DO NOT switch the programme on yet. The gates are in docs/quizbox-transformation/10_DEPLOYMENT_AND_ROLLBACK_PLAN.md section 3.
# =====================================================================================================

# =====================================================================================================
# UNDO (only if something is wrong; send me the error first). Paste in the project that needs it. Keeps all records.
# =====================================================================================================
# Get-Content -Raw -Encoding UTF8 supabase\rollback\affiliate_commission_foundation.sql | Set-Clipboard
