# QuizBox NEXT copy list, built from your fingerprint results. One line = one paste (VS Code: cursor on the line, Shift+Enter).
# Supabase > the project named in the step > SQL Editor > New query > Ctrl+V > Run. Expected: Success. Any red error: STOP and send me the error text.
Set-Location "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment"

# =====================================================================================================
# 0. OPTIONAL, READ-ONLY: which pieces of migrations 37 and 45 are missing on PREVIEW? Paste in PREVIEW, Run: each MISSING row names the part.
# Both migrations are safe to run again in full (37 inserts a policy only if it has no version yet; 45 is create-or-replace only), so section B below is correct either way.
# =====================================================================================================
Get-Content -Raw -Encoding UTF8 docs\release\DIAGNOSE_PREVIEW_37_45.sql | Set-Clipboard      # paste in PREVIEW, Run

# =====================================================================================================
# B. PREVIEW (project fngdtxayfoiffbcbmcum). Oldest first. Do not skip one or change the order.
# =====================================================================================================
# ---- 20261037100000  policy_seed_v1  (3 parts)
#      NOTE: Seeds the 4 policy drafts; each is inserted only for a document that has no version yet, so running it again is safe and never overwrites an edit.
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261037100000\p1.sql | Set-Clipboard      # part 1 of 3
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261037100000\p2.sql | Set-Clipboard      # part 2 of 3
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261037100000\p3.sql | Set-Clipboard      # part 3 of 3
# ---- 20261045100000  admin_exports  (6 parts)
#      NOTE: 46 is already on this project. Running 45 puts the 22-dataset export list back, so 46 is run again straight after (both are create-or-replace only, so this is safe). Do all of 45, then all of 46.
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261045100000\p1.sql | Set-Clipboard      # part 1 of 6
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261045100000\p2.sql | Set-Clipboard      # part 2 of 6
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261045100000\p3.sql | Set-Clipboard      # part 3 of 6
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261045100000\p4.sql | Set-Clipboard      # part 4 of 6
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261045100000\p5.sql | Set-Clipboard      # part 5 of 6
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261045100000\p6.sql | Set-Clipboard      # part 6 of 6
# ---- 20261046100000  admin_exports_more  (3 parts)
#      NOTE: run this straight after 45, in full. It restores the 31-dataset export list.
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261046100000\p1.sql | Set-Clipboard      # part 1 of 3
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261046100000\p2.sql | Set-Clipboard      # part 2 of 3
Get-Content -Raw -Encoding UTF8 docs\release\sql-parts\20261046100000\p3.sql | Set-Clipboard      # part 3 of 3

# =====================================================================================================
# C. PROVE THEY MATCH (read-only). Run on PRODUCTION, then on PREVIEW. Every row must say ok on both.
# =====================================================================================================
Get-Content -Raw -Encoding UTF8 docs\release\db_fingerprint_A.sql | Set-Clipboard      # paste in the project, Run, copy the table
Get-Content -Raw -Encoding UTF8 docs\release\db_fingerprint_B.sql | Set-Clipboard      # paste in the project, Run, copy the table
