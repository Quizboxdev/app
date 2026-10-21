# Curriculum and question-bank data quality (Phase 4)

Scope: the CSV files on disk in `Questions Bank/` (levels Primary, JHS, SHS) and the staged `_load/` files. The database copy of the questions was **not** compared (no database access), so "loaded" and "on disk" are not reconciled here. A deterministic scanner (`scripts/audit/qb_validate.py`, output in `evidence/qbank-validation-*.json`) checked every row. Deterministic checks say nothing about whether a question is factually or pedagogically right; that needs a subject teacher.

## What was checked

Header equals the 20-column template; empty question; empty options; duplicate options inside a question; answer key not A-D or pointing at an empty option; missing explanation, source reference or indicator; difficulty not easy/medium/hard; answer type; duplicate question text within a file and across files (same grade and subject); encoding damage; stray whitespace; very short questions; answer-key position share; a correct option that is much longer than the others (a guessing cue).

## Results

| Set | Files | Rows | Grades | Row count equals the number in the file name |
|---|---|---|---|---|
| Main (Primary, JHS, SHS) | 27 | 63,750 | B4 27,200; B5 16,400; B6 11,050; B7 4,750; SHS-1 4,350 | all 27 |
| Staged `_load/` | 12 | 17,750 | B4 12,400; B5 2,600; B6 650; SHS-1 2,100 | all 12 |

**Overlap:** a cross-check on grade, subject and normalised question text found that **all 17,750 staged rows are already present in the main files**. The staged folder is a slice of the main set, not additional questions, so the distinct total on disk is **63,750**, not 81,500.


| Check | Main | Staged | Verdict |
|---|---|---|---|
| Header, empty question, bad answer key, missing explanation, missing source reference, missing indicator, bad difficulty, duplicates (within or across files) | 0 | 0 | PASS |
| True/False rows (2 options, key A or B) | 3,553, all well-formed | 703 | PASS (the scanner's "missing option" flag on these is expected, not a defect) |
| Encoding damage (U+FFFD) | 1 row | the same row (it is a slice of main) | FAIL, P3: `B4_FRENCH_4600.csv` row 162, indicator B4.1.1.4.1: the question text itself reads "In the written phrase � demain" (an accented capital was lost), so the question is garbled for learners (QB-AUD-010) |
| Answer-key position | A 29.3%, B 24.8%, C 23.0%, D 22.8% | A 28.3% | Mild bias to A (QB-AUD-017) |
| Correct option is the longest by a wide margin | 1,168 rows (1.8%) | 216 rows | Low risk, review a sample |
| Difficulty mix | 30% easy / 40% medium / 30% hard exactly | same | Looks generated to a target, consistent |
| Indicator code format | B4-B7 codes start with the grade; SHS codes (`1.1.1.LI.1`) do not, and 16 of 37 are shared by more than one subject | | Info (QB-AUD-011): loaders must key by subject plus code |

## Not verified

* Referential integrity of the strand / sub-strand / indicator tree in the database, orphaned questions, class-to-subject mapping in the database.
* Factual accuracy of answers and explanations, mathematical notation, images (the CSVs hold none).
* Which of the 63,750 rows are already in the production bank (the owner-reported active count was 1,225 earlier; this audit did not re-query it).
* Re-import behaviour (idempotency) on a real database; covered only by existing PGlite tests.
* Delivery: question draw uses `order by random()`; options are shown in stored order. Scoring RPCs were not re-executed beyond the existing test suite.

## Recommended before loading anything

1. Fix row 162 of the B4 French file.
2. Run the loader's `balanceAnswerKey` so each file lands near 25% per letter.
3. Teacher spot-check 50 random rows per subject per grade for correctness.
4. Confirm unique keys include the subject for SHS.
