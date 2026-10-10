# Sample delivery audit: QuizBox_Science_B7_Delivery003_Q001001-Q001500.xlsx

Read-only check by Claude on 2026-10-10 of the first delivery workbook the owner proposed as the model for bulk loading.
Workbook: 6 sheets (QUESTION_BANK 34 columns, BATCH_CONTROL, VALIDATION_LOG, LEGEND, ANSWER_KEY_AUDIT, DISTRACTOR_QUALITY_AUDIT), 500 rows, 44 indicators, 5 strands.

## Structure: good
Strand → sub-strand → content standard → indicator hierarchy, difficulty E/M/H/X (175/175/100/50), cognitive level, marks, time, tags, curriculum reference. Answer key balanced at 25% per option. This maps well to the existing import contract.

## Content: not ready to import as verified
| Check (all 500 rows) | Result |
|---|---|
| Explanations that open "The correct response states the accepted scientific idea required by <code>" | 489 of 500 (2 distinct openings in total) |
| Stems "A B7 learner is answering a question about <indicator text>" | 98; another 97 start "Which scientific statement should a learner select about" |
| Distinct 8-word stem openings | 136 |
| Rows where a distractor shares as many key words with the indicator as the correct option | 158 |
| `validation_status` / `source_type` | all "DRAFT_VALIDATED" / "ORIGINAL_CURRICULUM_BECE_STYLE" |

Examples seen: a landform-habitat question whose distractors are about levers, the water cycle and digestion (off-topic, so trivially guessable); a stem with spliced text ("the di fferent types"); a question where three options are all true statements about domestic animals (several defensible answers); explanations that do not explain.

The workbook's own VALIDATION_LOG, ANSWER_KEY_AUDIT and DISTRACTOR_QUALITY_AUDIT report PASS_FOR_IMPORT and DISTRACTORS_STRONG. They were produced by the same generating process (`build_science_deliveries.mjs`) and do not match the rows, so they must not be treated as verification.

## Consequence
Import must run its own checks and SME sampling, independent of the workbook (tracker H3, H4).

## Whole Science folder (added same day)
`E:\App - QuizBox Solution Files\Curriculum\JHS\Science` holds six delivery workbooks (B7, B8, B9, deliveries 003 and 004: 3,000 questions), the NaCCA Science curriculum PDF, and one Computing workbook used as the template.

| Workbook | Rows | Indicators | Most common explanation opening (rows) | Most common stem opening (rows) |
|---|---|---|---|---|
| B7 Delivery003 | 500 | 44 | 489 | 98 |
| B7 Delivery004 | 500 | 44 | 125 | 125 |
| B8 Delivery003 | 500 | 33 | **500** | 100 |
| B8 Delivery004 | 500 | 33 | 104 | 104 |
| B9 Delivery003 | 500 | 38 | 487 | 99 |
| B9 Delivery004 | 500 | 38 | 111 | 111 |
| Computing B9 Batch008 (template) | 20 | 1 | 1 | 1 |

All 3,020 rows are marked `DRAFT_VALIDATED`.

**How they were made:** `Curriculum/JHS/build_science_deliveries.mjs` (365 lines) is a template program, not an AI model. Question stems are fill-in-the-blank frames (`A ${grade} science class is investigating ${topic} in ${context}...`), knowledge-item distractors are drawn from a pool of statements about other indicators, and explanations are fixed sentences (`The correct response ${demand} the accepted scientific idea required by ${indicator}...`). The calculation items (efficiency, Ohm's law) are computed properly and carry real worked explanations; those are sound. The audit sheets inside each workbook are produced by the same program.

**The Computing B9 batch (20 rows) is the quality model:** 20 distinct stems and 20 distinct explanations, i.e. written item by item.

**`QB-SCIENCE-SOURCE-RUNTIME-VERIFICATION.md` (2026-08-07)** also records unresolved blockers: no authoritative Science subject-registry row (subject code, learning-area identity) and no Apps Script importer found in the tree.
