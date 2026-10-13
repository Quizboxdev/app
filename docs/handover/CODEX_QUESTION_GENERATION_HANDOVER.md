# QuizBox: handover to Codex — question generation, audit and remaining build

Written 2026-10-12 by Claude Code for the owner (Ransford Mensah). Paste or point Codex at this file as its task. When Codex finishes,
hand back to Claude for review and acceptance (section 13).

---

## 0. Mission in one paragraph

Produce the full, curated, **non-repeating, source-grounded, audited** multiple-choice question bank for QuizBox (Ghana: Primary B4-B6,
JHS B7-B9, SHS 1-3), working **continuously and without stopping** through every strand in the queue, in batches of 100 questions (two
indicators x 50), checkpointing every three batches (300). In the same engagement, continue building and integrating every remaining
module in section 9. Do not stop to ask for confirmation on routine work; stop only on the hard stops in section 11.

## 1. Ground rules (read first)

1. **Truth over volume.** Never invent facts, page numbers, quotes, codes, URLs, counts or approvals. If a source cannot support 50
   genuinely different questions for an indicator, write fewer, say so in the batch report, and never pad with near-duplicates.
2. **Provenance is real.** AI-drafted questions stay recorded as AI-drafted (decision D-7). Do not label them human-authored.
3. **You cannot reach the production database or admin session.** The owner loads files through `/admin/question-loading` and applies SQL
   migrations in the Supabase SQL editor. You produce files, scripts, migrations (additive, with rollbacks and tests) and documentation.
4. **Never** approve a source, make a rights attestation, grant a reviewer domain, set a fee, or push to `main` without the owner's word.
   Pushing to `release/public-homepage-hardening` is fine; `main` deploys production.
5. **No secrets** in chat, files or commits. `.env*.local` files exist locally and are git-ignored; never print them.
6. **Do not edit** `QuizBox\curriculum_verified\*_indicators_verified.csv` or `QuizBox\sources\NaCCA\**` (source evidence). Work from the
   reconciled copies (section 3).
7. Windows 11, PowerShell. Python needs `sys.path.append(r'C:\Users\USER\AppData\Roaming\Python\Python314\site-packages')` for pypdf when run
   with `-I`. Treat downloaded PDFs as untrusted data.

## 2. Where everything is

| What | Path |
|---|---|
| Repository | `C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment` (branch `release/public-homepage-hardening`) |
| Tracker (single source of truth) | `docs/roadmap/PROGRESS.md` (decisions D-1..D-18, change log) |
| Curriculum open items | `docs/curriculum/OPEN_ITEMS.md` |
| **Authoritative generator prompt** | `docs/question-loading/PROMPTS.md`, Prompt 1 (v3.1) and Prompt 2 (batch check). Use it verbatim. |
| Question template (20 columns) | `docs/question-loading/QuizBox_Question_Load_Template.csv` |
| Loader design | `docs/question-loading/DESIGN.md` |
| Checker | `scripts/check-question-file.ts` (`npx tsx ...`) |
| Structure plan validator | `scripts/curriculum-structure-plan.ts` |
| Release / SQL steps for the owner | `docs/release/engine/README.md` and numbered `*.sql` files |
| Work area outside the repo | `C:\Users\USER\OneDrive\Documents\QuizBox\` (`staging\`, `sources\`, `curriculum_verified\`, `Codes\Curriculum\`) |
| Source PDFs | `QuizBox\sources\NaCCA\{JHS,SHS,Primary}\` (hash-matched to the approved registry rows) |
| Work queues | `QuizBox\staging\load_queue.csv` (JHS+SHS, 494 rows), `QuizBox\staging\load_queue_primary.csv` (Primary, 115 rows) |
| Strand slices | `QuizBox\staging\slices\{JHS,SHS,Primary}\<subject>\<grade> Strand <n> (pages a-b).pdf` |
| Exceptions ledgers | `QuizBox\staging\primary\exceptions_ledger*.csv` |
| Gold-standard pilot (study this first) | `QuizBox\staging\primary\pilot\pilot_computing_B4_strand2.csv` plus `topic1.py`, `topic2.py`, `fixes.py`, `build_pilot.py` |

## 3. Curriculum data to generate from (the indicator is the unit)

Use **only** these files for indicator identity, wording and codes:

| Level | File | Indicators | Questions at 50 each |
|---|---|---:|---:|
| Primary (8 subjects) | `staging\primary\Primary_indicators_reconciled.csv` (also copied to `curriculum_verified\`) | 1,012 | 50,600 |
| Primary: English + Ghanaian Language | `staging\primary\Primary_English_Ghanaian_reconciled.csv` | 669 | 33,450 |
| Primary: Creative Arts | `staging\primary\Primary_Creative_Arts_reconciled.csv` | 144 | 7,200 |
| JHS (11 subjects) | `curriculum_verified\JHS_indicators_verified.csv` | 1,302 | 65,100 |
| SHS (32 subjects) | `curriculum_verified\SHS_indicators_verified.csv` | 2,585 | 129,250 |

Columns: `subject, grade, strand_no, strand, sub_strand, content_standard_code, content_standard, indicator_code, printed_code, indicator, exemplars, page, wording_verified, flags`.

Rules that come with the data:
- **Never load or generate from** `Primary_indicators_verified.csv` (printed typos, heading variants). The reconciled file corrected 7
  mis-numbered rows with a ledger. Cite the **printed code** in `source_reference` when it differs from `indicator_code`.
- Rows flagged `PRINTED_CODE_TYPO`, `RECONCILED:*` or `EXEMPLARS_NOT_FOUND` are valid indicators; mention the flag in the batch report.
- Verified-file gaps (indicators printed in the PDF but not yet extracted, `NEEDS_INDICATOR_EXTRACTION`): SHS Additional Mathematics SHS2 s2-4 and SHS3 s1-4, SHS Arabic
  SHS2 s4 and SHS3 s1-4, SHS French SHS3 s1-4, SHS Physics SHS3 s2-4, SHS Literature-in-English SHS2 s1, JHS PE&H B7 s4, plus JHS Arabic
  and SHS core Mathematics (no indicators). Extract them with the same governed process used for Primary English/Ghanaian Language
  (`QuizBox\staging\tools\extract_primary_pdf.py`, `reconcile_*.py`; ledger every correction) BEFORE generating those strands.
- History and Physical Education (Primary) are inside the 1,012-row file.
- Page numbers: the CSV `page` is the printed page number; slice file names use PDF page indexes. The checker works on the FULL PDF.

**First task for Codex:** the Primary stager (`staging\tools\stage_primary.py`) reads only the 1,012-row file. Extend it to read all
three reconciled Primary files, add Creative Arts slices, regenerate `load_queue_primary.csv`, and re-run `validate_primary.py`. Expected:
1,825 indicators, 91,250 questions. Do the same for JHS/SHS after their gaps are filled.

## SHS verified-file gaps, measured 2026-10-13 (GH-SHS-2023)

Method: every `year.strand.sub.LI.n` code printed in each official SHS PDF compared with `SHS_indicators_verified.csv` (printed forms
normalised). "Missing" = printed in the PDF, absent from the file. Counts are indicators, not questions (x 50 each).

| Subject | In file | Printed in PDF | Missing | Where |
|---|---:|---:|---:|---|
| Mathematics (core) | 0 | 69 | 69 | all 12 strands; no indicators at all |
| Additional Mathematics | 63 | 123 | 60 | SHS2 s1-4 (25), SHS3 s1-4 (35) |
| Arabic | 75 | 116 | 44 | SHS2 s4 (9), SHS3 s1-4 (35) |
| French | 96 | 131 | 35 | SHS3 s1-4 |
| Government | 49 | 44 | 35 | all strands: code forms differ, INSPECT first (the file has more rows than the PDF prints) |
| Physics | 87 | 103 | 30 | SHS1 s3 (1), SHS3 s1-4 (29) |
| Literature in English | 87 | 88 | 4 | SHS3 s4 |
| Agriculture | 77 | 79 | 4 | SHS1 s1 (1), SHS2 s5 (3) |
| Performing Arts | 63 | 56 | 3 | SHS2 s3 (1), SHS3 s1 (2); inspect (forms) |
| General Science | 44 | 44 | 1 | SHS3 s2 |
| every other subject | | | 0 | complete |

Total to extract: about 285 indicators (about 14,000 questions) before SHS is complete. The SHS layout differs from Primary and JHS: a
learning outcome (`1.2.1.LO.1`) with learning indicators (`1.2.1.LI.1`) under a "Subject / Strand / Sub-Strand" table heading. The Primary
extractor (`staging/tools/extract_primary_pdf.py`) does not read it and needs an SHS variant. Reconcile with a ledger as for Primary.

## Source rows holding the wrong PDF (C-15 / C-20) and how to clear them

- "Agricultural Science" holds the Agriculture PDF (212 pages) and "Physical Education & Health (Core)" holds the Elective PDF (126 pages).
  The correct files are in `QuizBox\sources\NaCCA\SHS\` (Agricultural Science.pdf, 98 pages; Physical Education and Health (Core).pdf, 88 pages).
- The rows are approved, so the file cannot be released and the document is locked. Clear them without an override: register new rows
  under a new level label (as `QuizBox\staging\primary\curriculum_sources_shs_2023_import.csv` does for all SHS), supply the correct PDF,
  approve with the rights attestation, and activate. Do not generate questions for these two subjects against the wrong rows.

## 4. The generation unit and volume

- **One topic per learning indicator; 50 questions per topic** (decision D-15/D-18): 15 easy / 20 medium / 15 hard; cognitive
  Remember 8, Understand 16, Apply 14, Analyse 8, Evaluate 4; 3-8 concepts per topic, each at least 3 questions and no concept above
  25%; at most 5 TRUE_FALSE per 50.
- **Delivery unit = a batch of 100** (two indicators x 50) as one CSV with the 20-column template and header row.
  "3 x 100 per strand": for each strand, deliver its indicators in consecutive batches of 100 until the strand is complete (a strand with
  an odd indicator count ends with a 50). **Checkpoint after every 3 batches (300 questions)**: save outputs, run all gates, update the
  manifest, then continue to the next batch without waiting.
- Order of work: Primary (all) -> JHS -> SHS. Within a level: subject by subject, grade by grade, strand by strand, in queue order.
  Skip nothing silently: if a strand cannot be completed, log the reason in the manifest and move on.
- Total target at current data: 91,250 (Primary) + 65,100 (JHS) + about 129,000 (SHS) questions. Report progress as indicators done / total.

## 5. How to write each question (summary; the file is authoritative)

Follow `docs/question-loading/PROMPTS.md` Prompt 1 exactly, in particular:
1. Work only from the source slice/PDF. The curriculum names what to teach; for a thin source, general subject knowledge may fill the
   named skills (the pilot did this for MS PowerPoint Home tab tools) but never invent curriculum facts.
2. Every row individually written. No sentence frames with swapped words. A different scenario or angle for every question.
3. Rows in learning order (easy first), each tagged with exactly one concept; stand-alone questions (no "the previous question").
4. Options: one defensible correct answer; plausible distractors from real misconceptions; all four within 3 words of each other; **the
   correct option must be the longest in at most 1 question in 3** (the pilot first scored 59%: rebalance by editing options, not by
   padding). No "All of the above", no overlapping options. Answer letters balanced (about 25% each) per 50.
5. Explanation 20-60 words that teaches (idea, why right, tiny example, what the tempting wrong option gets wrong).
6. Plain text only. No `<`/`>`, no LaTeX. Write maths as `3/4`, `2 x 5`, `50%`.
7. `source_reference` = `<document>, page <printed page>, <printed indicator code>`; `source_quote` = one continuous verbatim passage
   (checker verifies word-for-word against the PDF; use the indicator wording or an exemplar sentence).
8. Level column `PRIMARY` / `JHS` / `SHS`; grade as printed (`B4`, `SHS 1`); subject exactly as in the CSV (`Our World Our People`, `FRENCH`).
9. Language subjects (English, French, Ghanaian Language, Arabic, Spanish): questions in the target-language skill the indicator names;
   keep prompts understandable at the stated grade. Ghanaian Language questions must be checked by a human speaker (flag in the report).
10. Age fit: B4-B6 learners are 9-12. Short sentences, concrete contexts (Ghana), no abstract jargon.

## 6. Non-repeat and audit requirements (build these tools; they are part of the deliverable)

Create `scripts/question-corpus-audit.ts` (and tests) that runs over **every batch ever produced**, per subject and grade, and fails the
build on any of:
- **Exact duplicate** stem (normalised: lower case, punctuation and digits collapsed) anywhere in the corpus.
- **Near duplicate**: Jaccard similarity on 3-word shingles >= 0.7 between two stems of the same subject+grade (reuse
  `lib/content/factory/similarity.ts` and `duplicates.ts` where suitable); also near-duplicate **correct answer + explanation** pairs.
- **Template reuse**: more than 8% of stems in a topic starting with the same first four words.
- Answer-letter skew (any letter outside 18-32% per 50), longest-correct above 40% per 50, explanations outside 20-60 words,
  concept with fewer than 3 or more than 25%, difficulty/cognitive spread off the target by more than 2 per class.
- Source check failures from `check-question-file.ts --source` (quotes, pages, codes).
Write `QuizBox\generated\AUDIT_REPORT.md` and a machine-readable `QuizBox\generated\manifest.csv`: one row per batch with file name,
sha256, rows, level/grade/subject/strand, indicator codes, source PDF sha256, checker verdict, audit verdict, generator and date.
A batch with any failure is regenerated, never "fixed up" silently; keep the failed file in `QuizBox\generated\_rejected\` with the reason.

## 7. Output layout and gates (per batch)

```
QuizBox\generated\<Level>\<Subject>\<Grade>\<Subject>_<Grade>_S<strand>_B<nn>.csv      (20 columns, UTF-8 with BOM, all fields quoted)
QuizBox\generated\<Level>\<Subject>\<Grade>\<same name>.check.txt                       (checker output)
```
Gate 1, per batch (must print `Can load: YES`, 0 errors, 0 warnings unless justified in the report):
```powershell
npx tsx scripts/check-question-file.ts "<batch.csv>" `
  --curriculum "<reconciled indicator csv for the level>" `
  --source "C:\Users\USER\OneDrive\Documents\QuizBox\sources\NaCCA\<Level>\<Subject>.pdf" `
  --problems "<batch>.problems.csv"
```
Gate 2, per checkpoint (300): `scripts/question-corpus-audit.ts` over the whole corpus so far.
Gate 3, per subject-grade complete: indicator coverage = 100% of indicators in the queue row, 50 questions each (or a documented shortfall).
The owner loads files in `/admin/question-loading` (curriculum GH-SBC-2019 for Primary, GH-CCP-JHS for JHS; SHS waits on D-17). Loading
the same file twice is blocked by hash; do not re-export a loaded batch under the same content.

## 8. Current system state (do not redo)

- **Primary** curriculum `GH-SBC-2019` v2019 is registered and active; structure loaded: 3,429 nodes, 1,825 indicators (8 verified
  subjects + English + Ghanaian Language + Creative Arts). 11 Primary sources ACTIVE (approved with rights attestation by the owner).
- **JHS** `GH-CCP-JHS`: 1,302 indicators loaded, 12 sources active. Pilot: Social Studies B7, 100 questions in review.
- **SHS**: curriculum `GH-SHS-2023` v2023 (decision D-17, 2026-10-13) is registered, structure loaded (2,585 indicators, 4,686 nodes) and
  the 32 approved sources are attached to it. Generate SHS last; see the gap table before section 4.
- **Primary pilot**: Computing B4 strand 2, 100 questions, loaded into SME review.
- **SME review pool** exists (R1-R3): reviewers need granted domains (subject exactly as in the CSV, grade `B4`...) and a compensation
  policy; the owner has registered the Computing domain. Verified working by the owner on 2026-10-12 (all applied and deployed,
  production `main` = `946b505`): reviewer-domain dropdown pool and `sme_support` capability (`20261012180000`), live front-page
  counts (`20261012190000`), simple learner practice builder "Build your own practice" (`20261012200000`), plus level guard
  (`20261012170000`) and source-file release (`20261012160000`). The quick-practice RPC was proven only on stand-in schemas in tests; if
  a learner run fails, fix it in `supabase/migrations/20261012200000_quick_practice.sql` with a NEW migration, never by editing applied ones.
- Tests: 905 passing, `next build` compiles. Keep both green on every commit.

## 9. Remaining modules to build and integrate (continue after, or interleave with, generation)

Follow the existing architecture: additive migrations with a rollback in `supabase/rollback/`, an isolated-PostgreSQL (PGlite) test,
server-side enforcement of every rule (the browser is never the only check), tracker row updated with evidence. Priority order:

1. **Question pipeline completion (L, R, T tracks)**: L6 route every loaded question into the SME pool and close a batch only when each
   question has a decision; L7 provenance labels (internal "AI-assisted, SME-verified", learners see "Reviewed by subject experts");
   L9 one clean subject/grade list for pickers (done for admin forms; extend to question files, teacher and learner selectors);
   R4-R8 sponsor-reviewer tag, compensation plan screen, earnings tracking, senior QA sampling and minimum review time, payout batches;
   T4 topic study mode for learners, T5 concept-level understanding measure (D-13), T6 teacher view of topic coverage and understanding.
2. **Learner experience**: verify the quick-practice builder end to end on Preview with a real learner account (A10/G1); topic study
   mode; teacher-managed accounts for under-13s (G8).
3. **Release gates**: C-track (apply pending migrations to production history, schema parity, grants hardening, replayable chain,
   backup and isolated-restore evidence, all P0 gates in `release:check`), G2 live acceptance green on Preview, G3 server-side
   pagination of teacher analytics, G4 media upload verified, G5 phone-width screenshots, G6 mutation/role matrix and cross-tenant
   negative tests, G9 error monitoring and incident runbook.
4. **Sponsor process (S1-S7)**: request form, admin queue, sponsor-scope loading through the same loader, pool verification, competition
   set-up from a verified pool, notifications, sign-off and publish. The sponsor self-service workspace stays off (F8).
5. **Extension / Challenges (X0-X12)**: only after the core gates (Gate 1 and 2 in the tracker) per decision 2026-10-08: reconnaissance
   documents first, then design-system components, composable roles, campaign domain, public Challenges, participant flows, campaign
   studio, governance. Read `QuizBox_Extension_Architecture_Blueprint_v1.0.docx` and the tracker maturity gate before touching shared code.
6. **Curriculum completeness**: extract the verified-file gaps (section 3), then add History/PE style source rows for any subject lacking
   a registry row, and propose the SHS code/version options for D-17 with the document evidence (covers read September 2023).

## 10. Working method

- Small commits, one concern each: typecheck, `npx vitest run`, `npm run build` before each commit. Message ends with your tool's
  co-author trailer. Update `docs/roadmap/PROGRESS.md` (change log + row evidence) in the same commit.
- Keep a running `QuizBox\generated\HANDOVER_LOG.md`: what was done, counts, decisions taken, anything that needs the owner.
- Be economical: generate, check, rebalance, commit; do not paste large outputs into chat; write them to files.
- If the checker reveals a systematic weakness (for example the correct option is long), fix the writing approach for all following
  batches, not only the failing one, and note it in the log.

## 11. Hard stops (stop and report; do not improvise)

- A source PDF is missing, unreadable, or does not match the registry hash.
- An indicator's wording or code cannot be located in the PDF.
- A batch cannot be made to pass Gate 1 after two regenerations.
- Any step would write to production, change a decision, grant access, or touch rights attestations.
- The corpus audit finds duplication across batches that cannot be resolved by regeneration.

## 12. Known pitfalls (learned the hard way)

- Loading the unreconciled Primary file added 59 duplicate nodes to production; always use the reconciled files.
- Indicator codes appear inside exemplar text as cross-references (`Refer to B5.4.3.1.2`); they are not indicators.
- Some PDFs print the same indicator twice on consecutive pages with small edits, or print a strand digit wrong; the ledgers record how
  each case was resolved. Do not re-litigate them without evidence.
- The checker compares printed page numbers; slices have different page indexes.
- `qb_grade` enum holds only B7-B9; Primary grades live in `canonical_grade_code` text. Never cast `B4` to the enum.
- Subject codes are case-sensitive in reviewer domains (`FRENCH`, `Our World Our People`).

## 13. Handing back to Claude for review and acceptance

Deliver, in `QuizBox\generated\` and the repo: `manifest.csv`, `AUDIT_REPORT.md`, `HANDOVER_LOG.md`, the rejected-file log, all batch
files, the scripts/migrations/tests you added, and an updated tracker. Then write `QuizBox\generated\ACCEPTANCE_REQUEST.md` with:
1. counts: indicators complete / total, questions, per level and subject; shortfalls with reasons;
2. the exact commands to reproduce every gate;
3. a list of modules completed with their commit ids, tests and the migrations the owner must apply;
4. open risks and decisions needed from the owner.

Claude will accept on these checks, and rejects a delivery that fails any:
- re-run of Gate 1 on a random 5% of batches and Gate 2 on the full corpus gives identical verdicts;
- hand review of 100 random questions across levels (answer defensible, distractors plausible, explanation teaches, age fit);
- no cross-batch near-duplicates; manifests match file hashes; no file edited after its check;
- tests and build green; migrations additive with rollbacks; no secrets or production writes in the history;
- tracker rows have real evidence, not intent.
