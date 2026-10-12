# Curriculum extract: what is verified and what is still missing

Last updated 2026-10-10. Datasets live in `QuizBox/curriculum_verified/` (JHS_indicators_verified.csv, SHS_indicators_verified.csv). Every row carries `wording_verified` and `flags`. Source documents: NaCCA PDFs (links in the two notebooks' Source References sheets).

## Verified
| Level | Indicators | Subjects | Wording verified |
|---|---|---|---|
| JHS (B7 to B9) | 1,302 | 11 | all; 31 Mathematics B9 and 54 Social Studies rows read directly from the PDFs |
| SHS (SHS 1 to 3) | 2,585 | 32 | 2,576; 9 flagged |

## Missing or open (each is a tracker row)
| ID | Item | Detail | Who |
|---|---|---|---|
| C-1 | JHS Social Studies | CLOSED 2026-10-10: extracted directly from the GES edition PDF (B7 to B10); B7 16, B8 19, B9 19 indicators, all codes in the text parsed; 34 of 54 rows have content-standard wording, 48 have exemplars. Flag `added_from_pdf_directly`. Note: the NaCCA website has no Social Studies JHS document | Claude |
| C-2 | SHS completeness | Wording is accurate, but the number of indicators printed per SHS PDF has not been compared with the extract (JHS was). SHS codes (`1.1.1.LI.1`) repeat within a grade, so the check needs strand and sub-strand | Claude |
| C-3 | 9 SHS rows not verbatim | Listed in the SHS file with flag `wording_not_verbatim` | Claude |
| C-4 | Non-standard printed codes | JHS 174, SHS 297 printed codes differ from the standard form (`B7 1.1.1.1`, `1.3.1.L1.1`, `1.3.3LI.1`). The standard key is derived from position; printed code is kept | Claude |
| C-5 | Source typos | e.g. JHS `B9 6.4.1.3` (should be 6.1.1.3), `B9.5.1.2.2.2`, a B8 code inside B9 content. Flagged, never silently corrected | Claude |
| C-6 | Possibly unextracted JHS indicators | English B9.5.1.1.4, French and Ghanaian Language B7.4.2.3.1, Computing B9.1.1.1.1 and B9.1.1.2.1 and one mistyped code, Career Technology B9.5.1.2.2, PE and Health B7.1.2.3.1, RME B7.2.3.4.5 | Claude, then owner |
| C-7 | Mathematics B9 added rows lack data | 31 rows added from the PDF have no exemplars in some cases and some lack content-standard wording | Claude |
| C-8 | Social Studies SHS and other subjects outside the two notebooks | Anything not in the 10 JHS or 32 SHS documents (for example Arabic, History at JHS) | Owner |
| C-9 | Exemplar completeness | English exemplars 88% verbatim, Career Technology 94%; exemplars not checked for being complete per indicator | Claude |
| C-10 | Which subjects are launch subjects | Not every subject is needed first | Owner decision |
| C-11 | SHS edition year | Read from the covers on 2026-10-11 (Computing, Geography, Social Studies): "Curriculum for Secondary Education (SHS 1 - 3), September 2023". The folder name in the URL says 2025 and decision D-16 used "SHS 2025". The curriculum code and version must follow the document, so GH-SHS-2025 is NOT registered until the owner decides (D-17) | Owner decision |
| C-12 | Subjects with a source PDF but no indicators | SHS Mathematics (core) and JHS Arabic are in the NaCCA source pack but absent from the extracted indicator files. They can be approved as sources; questions cannot be placed until extracted | Claude |
| C-13 | Index rows in the source pack | "Official CCP index" and "Official SHS index" are web pages, not documents. They stay pending and cannot be fetched or approved; ignore them in pending counts | Owner |
| C-14 | Verified indicator files stop part-way through some subjects | The PDFs print strands the verified CSV does not carry: SHS Additional Mathematics (SHS 2 strands 2-4, SHS 3 strands 1-4), Arabic (SHS 2 strand 4, SHS 3 strands 1-4), French (SHS 3 strands 1-4), Physics (SHS 3 strands 2-4), Literature-in-English (SHS 2 strand 1); JHS PE&H B7 strand 4 (one page). SHS Agricultural Science SHS 2 strand 5 (3 indicators in the CSV) has no printed code found in the PDF. Applied Technology SHS 3 strand 4 prints some year-3 pages with year-2 codes (2.4.x, 2.5.x). Queued as NEEDS_INDICATOR_EXTRACTION in QuizBox\staging\load_queue.csv | Claude |
| C-15 | Two SHS registry rows hold a sibling subject's PDF | Checked 2026-10-12 against the staged official files by SHA-256: the registry row "Agricultural Science" (ACTIVE) carries the Agriculture PDF (212 pages, 6347a277fcef…) and "Physical Education & Health (Core)" (NEEDS_REVIEW) carries the Elective PDF (126 pages, 81f84ebf6a3c…). The correct files are in QuizBox\staging source set: Agricultural Science 98 pages (d5d77ecee447…), PE&H Core 88 pages (57c53773999e…). Do not approve the Core row as it stands; the Agricultural Science row needs its file replaced before questions are checked against it | Owner + Claude |
