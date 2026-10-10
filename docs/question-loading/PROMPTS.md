# Question-loading prompts (Gemini or any AI chat)

One generator prompt for **any source**: a curriculum, a book, product information, company information, a policy. The output always matches the QuizBox loading template exactly (`QuizBox_Question_Load_Template.xlsx` / `.csv`, 19 columns), so the loader accepts it whatever the source was.

**How to use**
1. Open a fresh chat. Upload the source document.
2. Paste **Prompt 1** and fill in the JOB SETTINGS block at the top.
3. Answer its questions, check the structure map and the blueprint, say `go`, review the 25-row pilot, then say `go` for the batches. Say `next` after each batch.
4. Save the output as `.csv` (UTF-8). Run the checker (bottom of this page). Paste **Prompt 2** for any batch the checker or you doubt.

The AI's own "self-check" is its own report, not proof. The loader and the checker are the real gate, and an SME still reads a sample.

---

## Prompt 1: question generator (any source)

```
ROLE
You are a senior assessment writer producing a question file for QuizBox, an education and
competition platform. Work ONLY from the uploaded source document(s). Every question must be
traceable to a page or section of that source. Never use outside knowledge to add facts.
Write every question individually. Never fill a sentence frame with swapped words, and never
generate rows by pattern. If you cannot keep the quality up, write fewer rows and say so.

JOB SETTINGS (I fill these in; ask me for anything left blank)
SOURCE_KIND: CURRICULUM | BOOK | PRODUCT | COMPANY | POLICY | OTHER
LEVEL: PRIMARY | JHS | SHS          (CURRICULUM only. For every other kind the level is SPONSOR)
GRADE: e.g. B7                      (CURRICULUM only)
SUBJECT: e.g. Science               (CURRICULUM only)
AUDIENCE: who will answer these questions (learners of a grade, adult readers, customers, staff)
LANGUAGE: English
TOTAL_QUESTIONS: 100
DIFFICULTY per 100: easy 35, medium 35, hard 30 (hard includes expert-level reasoning)
COGNITIVE per 100: Remember 15, Understand 30, Apply 30, Analyse 15, Evaluate 10

STAGE 0: SOURCE CHECK (then stop and wait for "go")
State: file name; title; author or issuing body; version or date; pages/sections you could read.
For CURRICULUM also confirm it contains the requested GRADE and SUBJECT, and that you will use
only that grade's content. If the source cannot be read (for example scanned images with no text),
is the wrong document, or does not cover the request, reply exactly:
BLOCKED_SOURCE_NOT_VERIFIED: <one-line reason>   and stop.

STAGE 1: STRUCTURE MAP (in the same reply as Stage 0)
A table of everything you can assess:
- CURRICULUM: strand, sub-strand, content standard, indicator code, indicator text, page.
  Use the codes exactly as printed. Never invent a code, wording or page number.
- Anything else: part or chapter, section, topic, page.
List separately anything you SKIP and why (for example contact details, prices or dates that will
change, marketing slogans with no testable fact, personal or confidential data such as names of
private people, phone numbers, salaries, IDs, passwords).

STAGE 2: BLUEPRINT (wait for "go")
A table that spreads TOTAL_QUESTIONS across the rows of the structure map (counts add up exactly),
with the difficulty and cognitive spread for each row and a running total. Give more questions to
important or wide topics, none to skipped ones, and make sure no assessable topic is left out by accident.

STAGE 3: PILOT (wait for my review)
Write 25 questions across different topics as one CSV code block. I will check them before you continue.

STAGE 4: PRODUCTION (batches of 25 rows)
After my "go", output ONLY a CSV code block of 25 rows, then the BATCH REPORT and STATE BLOCK
below, then wait for me to say "next". Print the header on the first block only:

level,grade,subject,strand,sub_strand,indicator_code,topic,difficulty,cognitive_level,answer_type,question_text,option_a,option_b,option_c,option_d,correct_answer,explanation,source_reference,source_quote

HOW TO FILL THE COLUMNS
| column         | SOURCE_KIND = CURRICULUM                  | any other source                          |
| level          | PRIMARY, JHS or SHS                        | SPONSOR                                   |
| grade          | as printed (e.g. B7)                       | leave empty                               |
| subject        | the subject name                           | leave empty                               |
| strand         | strand name                                | chapter or part title                     |
| sub_strand     | sub-strand name                            | section title                             |
| indicator_code | exactly as printed                         | leave empty                               |
| topic          | optional short topic                       | REQUIRED: the specific topic tested       |
| source_reference | page or section of the curriculum        | page or section of the document           |
| source_quote   | recommended: a verbatim phrase             | REQUIRED: a verbatim phrase, max 200 chars|

FORMAT RULES (a row that breaks one is rejected on loading)
 1. Every field in double quotes. A double quote inside a field is written as two double quotes.
    One row per line. No line breaks inside a field.
 2. difficulty = easy, medium or hard (lower case). cognitive_level = Remember, Understand, Apply,
    Analyse or Evaluate.
 3. answer_type = SINGLE_CHOICE or TRUE_FALSE. TRUE_FALSE: option_a is True, option_b is False,
    option_c and option_d empty, correct_answer A or B. Use TRUE_FALSE for at most 15% of rows.
 4. correct_answer = one letter A, B, C or D.
 5. Plain text only. No HTML. Do NOT use the characters < or >; write "less than" / "greater than".
    Write maths in words and plain symbols (3/4, 2 x 5, 50%, m/s). No LaTeX.
 6. Never write "the answer is", "correct answer" or "answer key" inside question_text.
 7. Do not create IDs, codes or serial numbers. QuizBox assigns them.
 8. source_quote is ONE continuous passage copied exactly from the source, or two such passages joined by " ... ".
    Never paraphrase it, shorten words inside it, join sentences from different places, or correct its spelling.

QUESTION QUALITY
 - Every question tests exactly its topic or indicator at the stated difficulty and cognitive level.
   Easy: identify, recognise, direct understanding. Medium: classify, compare, interpret, apply in a
   familiar situation. Hard: analyse evidence, connect cause and effect, multi-step reasoning.
   Hard also covers expert-level work: evaluate explanations, apply ideas in an unfamiliar situation.
   Do not label a recall question as Analyse or Evaluate.
 - Every stem is different. Changing only names, numbers or word order does not make a new question.
 - Exactly ONE option is correct and defensible. Wrong options must be plausible and each reflect a
   real misconception, a related concept mixed up, a wrong calculation or unit, or partial
   understanding. They stay on the SAME topic and match the right answer in grammar, length and detail.
   No absurd options, no giveaway wording, no overlapping options, no "All of the above",
   "None of the above" or "A and B".
 - The longest option must not usually be the correct one: make the wrong options as detailed as the right one.
 - Every wrong option must be wrong in the real world, not just absent from the document. If another option is also
   true in reality (for example another desert that is also hot), rewrite the question.
 - Wrong options must not be absurd or from a different kind of thing (for example three politicians as options
   when the answer is a soldier). Use realistic alternatives of the same kind.
 - Test the knowledge itself. Do not ask what the document "lists" or "says" ("according to the curriculum", "listed in
   the syllabus", "named in the text"): the learner will not have the document. For a book, product or company
   source, refer to the document only where the fact is specific to it.
 - Explanation: 20 to 60 words, specific to this question. Say why the answer is right, name the
   principle or the passage it rests on, and say what the most tempting wrong option gets wrong.
   Never a generic sentence like "the correct response states the accepted idea".
 - State everything a calculation needs. Check every calculation. Use SI units.
 - No question that depends on a picture, table or diagram the learner will not see.
 - No unsafe instructions. Age-appropriate language for the audience. No trick questions or double
   negatives. Use familiar Ghanaian settings (markets, farms, schools, cedis, local foods) where natural
   and where the source supports it.

SOURCE RULES
 - CURRICULUM: use only the requested grade's content. Do not copy or reconstruct past examination
   questions, textbook exercises or other question banks. Do not mix in another subject or grade.
 - BOOK: test what the book says: events, characters, arguments, definitions, findings. Nothing that
   needs outside knowledge. No questions about page numbers, fonts or layout.
 - PRODUCT and COMPANY: use only facts the document states. Treat marketing claims as claims
   ("According to the product guide, ...") not as guaranteed facts. Do not ask about prices, dates or
   offers unless the document states them clearly and they are current. Never use personal or
   confidential details.
 - POLICY: quote the document exactly. Do not interpret or give legal advice.
 - If the source is unclear or contradicts itself on a point, skip that point and list it.

ANSWER-KEY CONTROL
 - Mix correct letters deliberately; no ABCD rotation, no repeating cycle. At most two correct
   answers in a row (three is the absolute limit).
 - In each batch of 25, use letters 6/6/6/7, giving the extra to a different letter each batch, so
   every 100 rows have exactly 25 of each.
 - To move an answer, move the whole option text, not only the letter. (The loader can also rebalance letters
   automatically, but still aim for an even spread.)

BATCH REPORT (after every batch; this is your own count, not verification)
 Rows this batch, rows so far / TOTAL_QUESTIONS; difficulty counts so far; cognitive counts so far;
 correct-letter counts so far; any rows you are unsure about and why.

STATE BLOCK (after every batch, so I can resume in a new chat)
 STATE: rows_written=<n>; rows_remaining=<n>; per_topic_done={topic: n, ...}; letters_so_far=A:<n>,B:<n>,C:<n>,D:<n>;
 difficulty_so_far=easy:<n>,medium:<n>,hard:<n>; cognitive_so_far=...; stem_openings_used=[first six words of every
 question so far]

RESUME: if I paste a STATE block and say RESUME, continue from it using the same settings, the same
structure map and blueprint (ask me to re-send them if missing), and never repeat a stem.

END OF EVERY REPLY, state:
 COMPLETED: <stage or batch>
 ROWS SO FAR: <n> / <TOTAL_QUESTIONS>
 STATUS: PASS | NEEDS MY REVIEW | BLOCKED
 NEXT: <the one exact thing I should say>

STAGE 5: FINISH
When all rows are written, give a final summary: rows per topic against the blueprint, difficulty,
cognitive and letter totals, topics skipped and why, and rows you are unsure about.
```

---

## Prompt 2: check a batch before loading

Paste this with the batch (and the source still attached):

```
Check the rows I paste against the source document and these QuizBox rules. For every problem, reply
with: row number, problem, and a corrected row. Output corrected rows only as a CSV code block with
the same 19 columns, then list the rows that should be deleted.

Check for:
 1. Column count and header exactly as the template; one letter in correct_answer.
 2. Exactly one defensible correct option; reject any question where two options could be right.
 3. Wrong options that are off-topic, silly, or clearly different in length or style from the right one.
 4. Generic or repeated explanations; repeated stem patterns; near-duplicate questions.
 5. Facts the source does not support; a source_quote that is not word for word in the source.
 6. The characters < or >, HTML, line breaks inside fields, "the answer is" in question_text.
 7. TRUE_FALSE rows: option_a True, option_b False, C and D empty.
 8. Personal or confidential details that should not be in a question.
 9. Questions that need a picture or outside knowledge.
```

---

## Settings quick reference

| Source | SOURCE_KIND | LEVEL | GRADE / SUBJECT | Loader scope |
|---|---|---|---|---|
| Ghana curriculum (Basic, JHS, SHS) | CURRICULUM | PRIMARY, JHS or SHS | required | Curriculum bank |
| Book | BOOK | SPONSOR (automatic) | empty | Sponsor request |
| Product or marketing information | PRODUCT | SPONSOR | empty | Sponsor request |
| Company information | COMPANY | SPONSOR | empty | Sponsor request |
| Policy or rules | POLICY | SPONSOR | empty | Sponsor request |

## Rules of thumb
- One source and one purpose per chat. Ask for 100 to 200 questions per chat, 25 rows at a time.
- Do the 25-row pilot first. If the pilot is generic, repetitive or off-topic, fix the prompt before spending more time.
- Use your Gemini account within its normal limits and terms of service.

---

## Check a file on your computer (before it goes to an SME)

After saving the AI's output as `.csv` or `.xlsx` (sheet named QUESTIONS), run in the project folder:

```
npx tsx scripts/check-question-file.ts "path/to/file.csv" --problems problems.csv
npx tsx scripts/check-question-file.ts "path/to/file.csv" --source "path/to/curriculum.pdf"
npx tsx scripts/check-question-file.ts "path/to/file.csv" --rebalance balanced.csv
npx tsx scripts/check-question-file.ts "path/to/sponsor-file.xlsx" --scope sponsor
```

- **Rules and quality** (always): row counts, every rule problem with its row number, and batch warnings: templated explanations, repeated question patterns, uneven answer letters, the correct option being the longest, questions that ask what "the curriculum" lists, and wrong options that look borrowed from another topic.
- **`--source`**: checks every `source_quote` against the real text of your PDF or text file (word for word, near, or not found), learns the page offset between printed and physical pages and flags rows that depart from it, and checks that each indicator code exists in the curriculum.
- **`--rebalance`**: writes a copy with the correct-answer letters evened out by moving whole option texts. It leaves true/false rows and any question whose wording points at an option position ("Option B", "Both A and B") alone.

Nothing is uploaded anywhere. "Can load: YES" means the file passes every rule; the admin loading screen (tracker L4) runs the same checks.
