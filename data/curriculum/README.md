# Curriculum structure extracts

Verified, machine-read structure of the official curricula: one row per learning indicator, copied exactly as printed, with the page it appears on. Produced by `scripts/extract-curriculum.ts` (deterministic parsing of the PDF text, no AI). Inputs to the curriculum structure (tracker D5/D6) and the topic registry (T1).

| File | Source document | Rows |
|---|---|---|
| `science_b7-b9_naccasite2023.csv` | https://nacca.gov.gh/wp-content/uploads/2023/06/SCIENCE.pdf (NaCCA, Science CCP, 2020/2021 edition, 170 pages) | 154 (B7 52, B8 46, B9 56) |
| `mathematics_b7-b9_naccasite2023.csv` | https://nacca.gov.gh/wp-content/uploads/2023/06/MATHEMATICS.pdf (259 pages) | 177 (B7 68, B8 58, B9 51) |
| `computing_b7-b9_naccasite2023.csv` | https://nacca.gov.gh/wp-content/uploads/2023/06/COMPUTING.pdf (95 pages) | 125 (B7 53, B8 37, B9 35) |
| `social-studies_b7-b10_ges.csv` | GES "Social Studies CCP Curriculum B7-B10" (owner's local copy, February 2020, 129 pages; not one of the 2023/06 NaCCA links) | 59 (B7 16, B8 14, B9 16, B10 13) |

Downloaded and read on 2026-10-10. Columns: `source_file, grade, subject, strand_no, strand, sub_strand_no, sub_strand, content_standard_code, content_standard, indicator_code, indicator, exemplars (numbered, joined with " || "), page_physical (PDF page), page_printed (number printed on the page)`.

## Known defects in the source documents (reported by the extractor, not hidden)
- **Same code used for two different indicators:** Science B9.2.3.2.2, B9.4.4.2.1, B9.5.2.2.1; Computing B7.2.1.1.3, B7.2.2.1.2, B7.2.2.1.3; Social Studies B8.5.2.1.1. Both rows are kept; the loader and topic registry must key on code plus wording until the documents are corrected.
- **Typos in printed codes** are normalised in the extract (for example "B7 1.1.2.1." read as B7.1.1.2.1, and "B8. 3.1.1" as B8.3.1.1).
- **Indicators the parser could not complete** (no exemplars found, or no content standard found) are listed by the extractor's anomaly report; Mathematics has about 30 of these from layout variants and needs a manual look before use.

## Re-running
```
npx tsx scripts/extract-curriculum.ts "path/to/curriculum.pdf" --subject "Science" --out extract.csv
```
It prints the indicator counts per grade and strand and the anomaly list.
