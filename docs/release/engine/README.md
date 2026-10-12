# Release the question engine: steps in order

Written for the owner. Every step is one copy command and one place to paste. Stop at the first thing that does not match "Expect" and send the text back.

Production Supabase project: `fmgccmqxfjppqydkhaiu`. Open it, then **SQL Editor > New query**. Paste, **Run**. Each migration file is its own transaction, so a failure leaves nothing half-applied.

Start every PowerShell session with:

```powershell
Set-Location "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment"
```

## 1. Git: publish the branch (not main yet)
```powershell
git status
git log --oneline -3
git push origin release/public-homepage-hardening
```
Expect: clean tree; the push is a fast-forward. This does not touch production.

## 2. Database: read-only checks
```powershell
Get-Content -Raw -Encoding UTF8 .\docs\release\engine\01_history.sql | Set-Clipboard
```
Paste, Run. Send me the table (it shows what the database records).

```powershell
Get-Content -Raw -Encoding UTF8 .\docs\release\engine\02_prerequisites.sql | Set-Clipboard
```
Paste, Run. **Expect one row, every value `true`.** Any `false`: stop and send it to me.

Confirm in the dashboard (Database > Backups) that a backup from today exists. The migrations only add objects and have rollbacks.

## 3. Database: apply the five migrations, one at a time, in this order
For each: run the clipboard command, paste, Run. Expect `Success. No rows returned`.

```powershell
Get-Content -Raw -Encoding UTF8 .\supabase\migrations\20261012100000_topic_registry.sql | Set-Clipboard
Get-Content -Raw -Encoding UTF8 .\supabase\migrations\20261012110000_curriculum_structure_import.sql | Set-Clipboard
Get-Content -Raw -Encoding UTF8 .\supabase\migrations\20261012120000_question_load.sql | Set-Clipboard
Get-Content -Raw -Encoding UTF8 .\supabase\migrations\20261012130000_sme_pool.sql | Set-Clipboard
Get-Content -Raw -Encoding UTF8 .\supabase\migrations\20261012140000_topic_assignment.sql | Set-Clipboard
```
Run them **one per paste** (copy file 1, paste and run, then copy file 2, and so on). An error such as `already exists` means that file was applied before: stop and tell me.

Then verify:
```powershell
Get-Content -Raw -Encoding UTF8 .\docs\release\engine\09_verify_after_migrations.sql | Set-Clipboard
```
**Expect:** `functions` 14, `tables_ok` true, `pool_column` true, and `pool_settings` `{daily_cap:100, max_open:50, pick_size:25, release_hours:24}`.

## 4. Git: deploy
Only after step 3 verifies.
```powershell
git push origin release/public-homepage-hardening:main
```
Then in Vercel confirm the production deployment is **Ready**, and open `/review`, `/admin/question-loading`, `/admin/curriculum-structure`, `/teacher/assignments/by-topic` while signed in as super admin.

## 5. App: register the two curricula
Open `/admin/market-setup` > **Register a curriculum**. Market: Ghana. Authority: the one GH-CCP-2020 uses (Markets > Authorities).

| Field | JHS | SHS |
|---|---|---|
| Code | `GH-CCP-JHS` | `GH-SHS-2025` |
| Name | Ghana Common Core Programme (JHS B7 to B9) | Ghana SHS Curriculum (SHS 1 to SHS 3) |
| Version | 2020 | 2025 |
| Source document | QuizBox verified indicator extract of the NaCCA Common Core Programme (JHS) | QuizBox verified indicator extract of the NaCCA SHS curriculum |
| Source SHA-256 | run the JHS command below | run the SHS command below |

```powershell
(Get-FileHash -Algorithm SHA256 "C:\Users\USER\OneDrive\Documents\QuizBox\curriculum_verified\JHS_indicators_verified.csv").Hash.ToLower() | Set-Clipboard
(Get-FileHash -Algorithm SHA256 "C:\Users\USER\OneDrive\Documents\QuizBox\curriculum_verified\SHS_indicators_verified.csv").Hash.ToLower() | Set-Clipboard
```
The fingerprint is of the extract the structure is loaded from. The form asks for the official PDF's fingerprint instead if you prefer; the record cannot be edited afterwards, so decide first.

## 6. App: load the structure (JHS, then SHS)
`/admin/curriculum-structure`: choose the curriculum, choose the CSV, leave subject and grade empty, Load. To open the folder:
```powershell
explorer.exe /select,"C:\Users\USER\OneDrive\Documents\QuizBox\curriculum_verified\JHS_indicators_verified.csv"
```
Expect: JHS 1,302 indicators, SHS 2,585. Running it again changes nothing.

## 7. Database: gate before sources (read-only)
```powershell
Get-Content -Raw -Encoding UTF8 .\docs\release\engine\03_sources_by_curriculum.sql | Set-Clipboard
Get-Content -Raw -Encoding UTF8 .\docs\release\engine\04_curricula_and_approved_sources.sql | Set-Clipboard
```
Run each and send me both results. This shows which curriculum the 47 sources belong to, and which curricula have an approved source. Loading questions needs an **active** curriculum with an **approved** source; I will give the exact next step from these results.

## 8. App: reviewers and fees
- `/admin/reviewers`: SME profile (status `verified`, active), then a domain: **subject code exactly as in the CSV** (for example `Social Studies`), market Ghana, grade codes (for example `B7`), can review. Sponsor reviewers: Specialization `SPONSOR`.
- `/admin/compensation`: policy, then a version: currency `GHS`, base fee and approve fee, effective from now. A review pays base plus approve fee.
- Limits (optional): edit and run `docs\release\engine\10_pool_settings.sql`:
```powershell
Get-Content -Raw -Encoding UTF8 .\docs\release\engine\10_pool_settings.sql | Set-Clipboard
```

## 9. Questions: prompt, check, load
Prompt 1 (generator) to the clipboard, then paste into Gemini and upload the document:
```powershell
(Get-Content -Encoding UTF8 .\docs\question-loading\PROMPTS.md)[19..182] -join "`n" | Set-Clipboard
```
Prompt 2 (check a batch):
```powershell
(Get-Content -Encoding UTF8 .\docs\question-loading\PROMPTS.md)[192..211] -join "`n" | Set-Clipboard
```
Save each batch as `.csv` or `.txt`. Check them together (read-only, nothing is sent):
```powershell
npx tsx scripts/check-question-file.ts "<batch 1 file>" "<batch 2 file>" --curriculum "C:\Users\USER\OneDrive\Documents\QuizBox\curriculum_verified\JHS_indicators_verified.csv"
```
Only a file that prints `Can load: YES` goes to `/admin/question-loading`. The two existing Social Studies batches print `Can load: NO` (guessing cue: the correct option is the longest in 87 of 96 questions); regenerate them with Prompt 1.

## 10. Release a wrong source file (added 2026-10-12)

A source row that holds the wrong PDF and has not been approved (NEEDS_REVIEW or REJECTED) can be released, so the correct file can be supplied. Approved and active rows are never touched.

```powershell
Set-Clipboard -Value (Get-Content -Raw "supabase\migrations61012160000_source_file_release.sql")
```
Paste in the Supabase SQL editor of the production project and run. Then deploy the app (Curriculum Sources shows a "Release file" button on those rows).

Primary check (read only): `docs/release/engine/11_primary_diagnostic.sql`. Rollback: `supabase/rollback/source_file_release.sql`.

## 11. Primary (B4-B6): curriculum GH-SBC-2019 (added 2026-10-12, decision D-18)

The Primary curriculum already exists and is active (`GH-SBC-2019`, version 2019, 34 skeleton nodes). It has no structure and no source yet.

1. **Database (once):** apply `supabase\migrations\20261012170000_structure_import_level_guard.sql` the same way as step 3. It makes the server refuse Primary content in a JHS/SHS curriculum and the reverse. Rollback: `supabase\rollback\structure_import_level_guard.sql`.
2. **Deploy** the release branch (step 4) so the Curriculum structure screen knows the Primary level.
3. **App:** `/admin/curriculum-structure`, curriculum `GH-SBC-2019`, source version `2019`, file `QuizBox\staging\primary\Primary_indicators_reconciled.csv`, Load. Expect **1,954 nodes in the file; 22 already exist (level, grades, 18 subjects), so 1,932 are created**. Running it again changes nothing.
4. **Verify (read only):** `12_primary_verify.sql` (expected counts are in its header).
5. **Sources:** `/admin/curriculum-sources`, import `Codes\Curriculum\curriculum_sources_primary.csv` as a package for Ghana, map level `Primary` to `GH-SBC-2019`; then upload each official PDF from `QuizBox\sources\NaCCA\Primary\` and approve each with your rights attestation. Nothing here approves a source for you.

Pilot after that: Computing B4 strand 2 (2 indicators, 100 questions). Full plan and exception ledger: `QuizBox\staging\README.md` (Primary section).

## Rollback (reverse order, same paste method)
```powershell
Get-Content -Raw -Encoding UTF8 .\supabase\rollback\structure_import_level_guard.sql | Set-Clipboard
Get-Content -Raw -Encoding UTF8 .\supabase\rollback\topic_assignment.sql | Set-Clipboard
Get-Content -Raw -Encoding UTF8 .\supabase\rollback\sme_pool.sql | Set-Clipboard
Get-Content -Raw -Encoding UTF8 .\supabase\rollback\question_load.sql | Set-Clipboard
Get-Content -Raw -Encoding UTF8 .\supabase\rollback\curriculum_structure_import.sql | Set-Clipboard
Get-Content -Raw -Encoding UTF8 .\supabase\rollback\topic_registry.sql | Set-Clipboard
```
Rolling back drops the topic and load records. Questions already loaded stay as ordinary questions.
