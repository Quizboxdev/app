# Curriculum extract: what is verified and what is still missing

Last updated 2026-10-10. Datasets live in `QuizBox/curriculum_verified/` (JHS_indicators_verified.csv, SHS_indicators_verified.csv). Every row carries `wording_verified` and `flags`. Source documents: NaCCA PDFs (links in the two notebooks' Source References sheets).

## Verified
| Level | Indicators | Subjects | Wording verified |
|---|---|---|---|
| JHS (B7 to B9) | 1,248 | 10 | all; 31 Mathematics B9 rows read directly from the PDF |
| SHS (SHS 1 to 3) | 2,585 | 32 | 2,576; 9 flagged |

## Missing or open (each is a tracker row)
| ID | Item | Detail | Who |
|---|---|---|---|
| C-1 | JHS Social Studies | Not in the NaCCA notebook. The GES edition (B7 to B10) is at `E:\App - QuizBox Solution Files\Curriculum\JHS\SOCIAL-STUDIES-CCP-CURRICULUM-B7-B10.pdf`; B7 slices are in `QuizBox\BS7 Social Studies\sources`. Extract B7 to B9 the same way as Mathematics B9 | Claude |
| C-2 | SHS completeness | Wording is accurate, but the number of indicators printed per SHS PDF has not been compared with the extract (JHS was). SHS codes (`1.1.1.LI.1`) repeat within a grade, so the check needs strand and sub-strand | Claude |
| C-3 | 9 SHS rows not verbatim | Listed in the SHS file with flag `wording_not_verbatim` | Claude |
| C-4 | Non-standard printed codes | JHS 174, SHS 297 printed codes differ from the standard form (`B7 1.1.1.1`, `1.3.1.L1.1`, `1.3.3LI.1`). The standard key is derived from position; printed code is kept | Claude |
| C-5 | Source typos | e.g. JHS `B9 6.4.1.3` (should be 6.1.1.3), `B9.5.1.2.2.2`, a B8 code inside B9 content. Flagged, never silently corrected | Claude |
| C-6 | Possibly unextracted JHS indicators | English B9.5.1.1.4, French and Ghanaian Language B7.4.2.3.1, Computing B9.1.1.1.1 and B9.1.1.2.1 and one mistyped code, Career Technology B9.5.1.2.2, PE and Health B7.1.2.3.1, RME B7.2.3.4.5 | Claude, then owner |
| C-7 | Mathematics B9 added rows lack data | 31 rows added from the PDF have no exemplars in some cases and some lack content-standard wording | Claude |
| C-8 | Social Studies SHS and other subjects outside the two notebooks | Anything not in the 10 JHS or 32 SHS documents (for example Arabic, History at JHS) | Owner |
| C-9 | Exemplar completeness | English exemplars 88% verbatim, Career Technology 94%; exemplars not checked for being complete per indicator | Claude |
| C-10 | Which subjects are launch subjects | Not every subject is needed first | Owner decision |
