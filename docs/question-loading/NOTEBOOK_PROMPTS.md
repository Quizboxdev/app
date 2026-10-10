# NotebookLM prompts: extract the curriculum structure

Use these in your two notebooks (JHS and SHS), which hold the official NaCCA curriculum documents. NotebookLM answers only from the sources in the notebook and cites them, so it is the right tool for **exact extraction**. The extract it produces becomes the verified curriculum structure and the **topic map** for question writing (`PROMPTS.md`).

**The flow**
1. **N0**: check that every source really loaded with curriculum text. Run once per notebook.
2. **N1**: list what the notebook contains (subjects, grades, indicator counts). Run once per notebook.
3. **N2**: extract one subject and one grade at a time, strand by strand. This is the main prompt.
4. Save each reply to a text file (copy the CSV block into a `.txt`) and send me the file names. I check the extract against the original PDF, so what reaches the system is verified, not trusted.
5. **N3** (optional): fact sheets per topic, when a source holds real content (a textbook or teacher guide), not only the curriculum.

Two cautions: NotebookLM can import a web page's text but may not read a PDF behind a link, so N0 matters. And its answers are limited in length, so N2 works in small pieces and says when to continue.

---

## N0: source health check (run first)

```
List every source in this notebook, one per row, as a CSV code block with these columns:
source_title,source_type,subject,grades_covered,issuing_body,year_or_version,looks_like_full_curriculum_text,approx_pages,problem

Rules:
- Use only what you can actually see in each source. Do not guess.
- looks_like_full_curriculum_text = YES only if the source contains the curriculum's strands, content
  standards and learning indicators as text. Write NO for a menu page, a landing page, a list of links, or an
  empty or image-only source.
- problem: write NONE, or say what is wrong (for example "only a web page with links", "no indicator codes",
  "scanned images, no text", "duplicate of another source").
- After the table, list the sources that could not be read.
```

## N1: inventory of subjects, grades and indicator codes

```
For every source that contains a curriculum, give a CSV code block with one row per subject and grade:
subject,grade,source_title,strands_count,sub_strands_count,content_standards_count,indicator_count,first_indicator_code,last_indicator_code

Rules:
- Count only items printed in the source. Use the codes exactly as printed (for example B7.1.1.1.1; for SHS
  they may look different, such as SHS 1.1.1.1 or B10.1.1.1.1).
- If a count is uncertain, write the number you can verify and add "(partial)" in the last column's note.
- Add a final column "note" for anything unusual (for example a grade missing from a document).
Do not invent any row. If a subject appears in two sources, list both.
```

## N2: structure extract (one subject and one grade at a time)

Change the three values in the first line, then paste. For a long subject say "strands 1 to 2 first" and ask it to continue.

```
SUBJECT: <e.g. Social Studies>   GRADE: <e.g. B7 or SHS1>   LEVEL: <JHS or SHS>   PART: <all strands, or "strands 1 to 2">

Extract the learning structure for this subject and grade from the notebook's sources. Output ONE CSV code block
per strand (every field in double quotes; a double quote inside a field is written twice) with exactly these columns:

source_file,level,grade,subject,strand_no,strand,sub_strand_no,sub_strand,content_standard_code,content_standard,indicator_code,indicator,exemplars,page,proposed_topic,proposed_concepts

RULES (extraction, not interpretation)
1. One row per LEARNING INDICATOR. Copy codes and wording EXACTLY as printed. Do not summarise, correct, merge or
   reword anything. Keep the source's spelling and punctuation.
2. exemplars = every exemplar or suggested activity listed under that indicator, copied word for word, numbered as
   in the source and joined with " || " (for example: 1) Explain: i. environment ii. sanitation || 2) Discuss the
   types of environment). Never leave out an exemplar.
3. page = the printed page number where the indicator appears; if the source has no page numbers, the section
   heading instead. source_file = the exact source title.
4. Use only this subject and this grade. Ignore other grades and other subjects in the same document.
5. If something is not in the source, write NOT_FOUND. Never fill a gap from memory.
6. proposed_topic and proposed_concepts are the ONLY fields that are your judgement:
   - proposed_topic: the unit a teacher would teach in one to three lessons, in plain teacher language. It may be the
     indicator itself or part of it (a very broad indicator may be split into two rows with the same indicator
     fields and different proposed_topic).
   - proposed_concepts: 3 to 8 separate ideas a learner must grasp for that topic, separated by semicolons, taken
     from the exemplars.
7. Sort by indicator code.

AFTER THE LAST TABLE write these control lines:
 - INDICATORS EXTRACTED: <number>
 - INDICATOR CODES IN ORDER: <all codes, comma-separated>
 - ANYTHING THAT MAY BE MISSING OR UNCLEAR: <list, or NONE>
 - CONTINUE FROM: <next strand or indicator code, or DONE>
```

## N3: fact sheet per topic (optional, when a source holds real content)

Use this only if the notebook also contains a textbook, teacher's guide or notes. The curriculum itself says what to teach, not the facts.

```
TOPIC: <proposed_topic>   INDICATOR: <code>   GRADE: <grade>   SUBJECT: <subject>

List the facts, definitions, examples and key steps a learner at this grade needs for this topic, taken ONLY from
the notebook's sources. One fact per line as a CSV code block with columns:
concept,fact,source_title,page_or_section,verbatim_phrase

Rules: every fact must have a citation. verbatim_phrase is a short phrase (under 200 characters) copied exactly
from the source that supports the fact. Group by concept. If the notebook has no content source for this topic
beyond the curriculum itself, write exactly: NO CONTENT SOURCE, and list only what the exemplars themselves state.
Do not add anything from outside the sources.
```

---

## What I do with the output
- Check every row against the original PDF: codes exist, wording is verbatim, exemplars are complete, indicator counts match.
- Turn the verified extract into the curriculum structure and the **topic registry** (tracker T1), so teachers see topics named in plain language and each topic links to its curriculum indicator.
- Feed the topic map to the question prompt, so the AI no longer guesses topics. Because NotebookLM cites its sources, I can also adapt the question prompt for it, so question rows carry quotes it has verified.
