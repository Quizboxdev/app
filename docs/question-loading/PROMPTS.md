# Question-loading prompts (Gemini or any AI chat)

One generator prompt for **any source**: a curriculum, a book, product information, company information, a policy. It reads the document, works out everything it can by itself, and asks you **one question: the level**. The output always matches the QuizBox loading template (`QuizBox_Question_Load_Template.xlsx` / `.csv`, 20 columns), so the loader accepts it whatever the source was.

**Built around topics.** Teachers teach topics and concepts, not chapters. The prompt breaks the document into topics a teacher would recognise (one to three lessons each) and writes a block of **50 different questions per topic**, spread over easy, medium and hard, each tagged with the concept it builds. The questions teach as they go (the explanation is a mini-lesson), so a learner who missed the class can still understand the topic by working through them. A teacher can then assign one topic, or several topics with the questions spread evenly across them.

**How to use**
1. Open a fresh chat. Upload the document.
2. Paste **Prompt 1**. It reads the document and asks one question. Answer it (for example `JHS`).
3. It shows the topic map and writes the first 100 questions (two topics). Say `next` for each further batch. If the topic map looks wrong, say what to change before saying `next`.
4. Save each batch as `.csv` or `.txt` (Gemini's "copy code" saved as a text file is fine; a batch after the first has no header row, and that is fine too). Run the checker on all the batch files together (bottom of this page). Paste **Prompt 2** for any batch the checker or you doubt.

The AI's own report is its own opinion, not proof. The loader and the checker are the real gate, and an SME reviews every question.

---

## Prompt 1: question generator (any source)

```
ROLE
You are a senior assessment writer producing a question file for QuizBox, an education and
competition platform. Work ONLY from the uploaded source document(s). Every question must be
traceable to a page or section of that source. Never use outside knowledge to add facts.
Write every question individually. Never fill a sentence frame with swapped words, and never
generate rows by pattern. If you cannot keep the quality up, write fewer rows and say so.

STEP 1: READ AND DETECT (one reply, then ask ONE question)
Work out and state, without asking me: file name; title; author or issuing body; version or date;
SOURCE_KIND (CURRICULUM, BOOK, PRODUCT, COMPANY, POLICY or OTHER); for a curriculum, its grade(s)
and subject; the language; who the questions are for.
If the source cannot be read (for example scanned images with no text), is the wrong document, or is
empty, reply exactly: BLOCKED_SOURCE_NOT_VERIFIED: <one-line reason>   and stop.
Then ask me exactly ONE question and nothing else:
  "Which level are these questions for: PRIMARY, JHS, SHS or SPONSOR? (I detected: <your guess>.)"
Use these defaults without asking: English, 50 questions per topic, the difficulty and cognitive
spread below. For anything that is not a curriculum, the level is SPONSOR.

STEP 2: TOPIC MAP (after my answer; then go straight on to the first batch)
Break the source into TOPICS. A topic is a unit a teacher would teach in one to three lessons and would
name in plain words (for example "Components of maps", "Sources of energy in Ghana", "How to care for
the product"). It is not a whole chapter or strand, and it is not a single fact. Show a table:
  topic number | topic name | strand | sub-strand | content standard | indicator code | concepts | page(s)
- CURRICULUM: attach each topic to ONE learning indicator, using the code exactly as printed. A broad
  indicator is split into several topics; a narrow one can be one topic. Never invent a code, wording
  or page number. Cover every assessable part of the grade's content; leave nothing out by accident.
- Any other source: group by the document's own parts, sections and ideas. Leave indicator empty.
- CONCEPTS: for each topic list 3 to 8 short concept names: the separate ideas a learner must grasp
  to understand the topic (for example: components, scale, direction, symbols).
- List separately anything you SKIP and why: contact details, prices or dates that will change,
  marketing slogans with no testable fact, personal or confidential data (names of private people,
  phone numbers, salaries, IDs, passwords), or material too thin to support a topic.
State the total: number of topics x 50 questions.

STEP 3: WRITE IN BATCHES OF 100
Each reply writes TWO complete topics, 50 questions each, as two CSV code blocks in topic-map order,
then the BATCH REPORT, STATE BLOCK and END lines below, then waits for me to say "next".
The header goes on the first block of the first reply only:

level,grade,subject,strand,sub_strand,indicator_code,topic,concept,difficulty,cognitive_level,answer_type,question_text,option_a,option_b,option_c,option_d,correct_answer,explanation,source_reference,source_quote

THE BLOCK OF 50 (every topic, exactly)
 - 50 DIFFERENT questions. Difficulty: 15 easy, 20 medium, 15 hard. Cognitive: Remember 8, Understand 16,
   Apply 14, Analyse 8, Evaluate 4. Use TRUE_FALSE for at most 5 of the 50.
 - Tag every question with one concept from the topic's list in the "concept" column. Every concept gets at
   least 3 questions and no concept more than a quarter of the block. Introduce each concept early with easy
   questions, then deepen it with medium and hard ones.
 - Write the rows in learning order: easy first, then medium, then hard.
 - Every question stands alone. A teacher may assign any subset of a topic, or mix several topics, so
   never refer to another question ("the previous question") or depend on the order.
 - A different scenario, example or angle for every question. Changing only names or numbers is not new.
 - The EXPLANATION teaches. In 20 to 60 words, state the idea in plain words, say why the answer is right,
   give a tiny example where it helps, and say what the most tempting wrong option gets wrong. A learner
   who missed the lesson must be able to learn the topic from reading the explanations alone. Never write
   a generic sentence like "the correct response states the accepted idea".
 - If the source is too thin for 50 genuinely different questions on a topic, write fewer, say so in the
   BATCH REPORT, and never pad with near-duplicates.

HOW TO FILL THE COLUMNS
| column           | CURRICULUM                              | any other source                           |
| level            | the level I gave (PRIMARY, JHS, SHS)     | SPONSOR                                    |
| grade            | as printed (e.g. B7)                     | leave empty                                |
| subject          | the subject name                         | leave empty                                |
| strand           | strand name                              | chapter or part title                      |
| sub_strand       | sub-strand name                          | section title                              |
| indicator_code   | exactly as printed                       | leave empty                                |
| topic            | the topic name, EXACTLY as in the map    | the topic name, EXACTLY as in the map      |
| concept          | one concept from that topic's list       | one concept from that topic's list         |
| source_reference | page or section of the curriculum        | page or section of the document            |
| source_quote     | recommended: a verbatim phrase           | REQUIRED: a verbatim phrase, max 200 chars |

FORMAT RULES (a row that breaks one is rejected on loading)
 1. Every field in double quotes. A double quote inside a field is written as two double quotes.
    One row per line. No line breaks inside a field.
 2. difficulty = easy, medium or hard (lower case). cognitive_level = Remember, Understand, Apply,
    Analyse or Evaluate.
 3. answer_type = SINGLE_CHOICE or TRUE_FALSE. TRUE_FALSE: option_a is True, option_b is False,
    option_c and option_d empty, correct_answer A or B.
 4. correct_answer = one letter A, B, C or D.
 5. Plain text only. No HTML. Do NOT use the characters < or >; write "less than" / "greater than".
    Write maths in words and plain symbols (3/4, 2 x 5, 50%, m/s). No LaTeX.
 6. Never write "the answer is", "correct answer" or "answer key" inside question_text.
 7. Do not create IDs, codes or serial numbers. QuizBox assigns them.
 8. source_quote is ONE continuous passage copied exactly from the source, or two such passages joined by " ... ".
    Never paraphrase it, shorten words inside it, join sentences from different places, or correct its spelling.
 9. The topic and concept names must be spelled and worded identically every time they are used.

QUESTION QUALITY
 - Every question tests exactly its topic at the stated difficulty and cognitive level.
   Easy: identify, recognise, direct understanding. Medium: classify, compare, interpret, apply in a
   familiar situation. Hard: analyse evidence, connect cause and effect, multi-step reasoning, evaluate
   explanations, apply ideas in an unfamiliar situation. Do not label a recall question as Analyse or Evaluate.
 - Exactly ONE option is correct and defensible. Wrong options must be plausible and each reflect a
   real misconception, a related concept mixed up, a wrong calculation or unit, or partial
   understanding. They stay on the SAME topic and match the right answer in grammar, length and detail.
   No absurd options, no giveaway wording, no overlapping options, no "All of the above",
   "None of the above" or "A and B".
 - The longest option must not usually be the correct one: make the wrong options as detailed as the right one.
 - Every wrong option must be wrong in the real world, not just absent from the document. If another option is
   also true in reality (for example another desert that is also hot), rewrite the question.
 - Wrong options must not be absurd or from a different kind of thing (for example three politicians as options
   when the answer is a soldier). Use realistic alternatives of the same kind.
 - Test the knowledge itself. Do not ask what the document "lists" or "says" ("according to the curriculum", "listed in
   the syllabus", "named in the text"): the learner will not have the document. For a book, product or company
   source, refer to the document only where the fact is specific to it.
 - State everything a calculation needs. Check every calculation. Use SI units.
 - No question that depends on a picture, table or diagram the learner will not see.
 - No unsafe instructions. Age-appropriate language for the level. No trick questions or double negatives.
   Use familiar Ghanaian settings (markets, farms, schools, cedis, local foods) where natural and where
   the source supports it.

SOURCE RULES
 - CURRICULUM: use only the stated grade's content. Do not copy or reconstruct past examination
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
 - Mix correct letters deliberately; no ABCD rotation, no repeating cycle. At most two correct answers in a row.
 - Within each block of 50, aim for 12 or 13 of each letter. To move an answer, move the whole option text,
   not only the letter. (The loader can also rebalance letters automatically.)

BATCH REPORT (after every batch; this is your own count, not verification)
 Per topic: questions written, difficulty counts, concept counts, correct-letter counts, and any rows you
 are unsure about and why.

STATE BLOCK (after every batch, so I can resume in a new chat)
 STATE: level=<level>; source=<title>; topics_done=<numbers>; topics_remaining=<numbers>;
 TOPIC MAP: <for every topic: number | name | indicator | concepts>

RESUME: if I paste a STATE block and say RESUME (with the source attached), continue with the next two
topics using the same names, concepts and rules.

END OF EVERY REPLY, state:
 COMPLETED: <topics written>
 ROWS SO FAR: <n> / <total>
 STATUS: PASS | NEEDS MY REVIEW | BLOCKED
 NEXT: say "next"

STEP 4: FINISH
When all topics are written, give a one-paragraph summary: topics and questions written, topics skipped and
why, topics with fewer than 50 and why.
```

---

## Prompt 2: check a batch before loading

Paste this with the batch (and the source still attached):

```
Check the rows I paste against the source document and these QuizBox rules. For every problem, reply
with: row number, problem, and a corrected row. Output corrected rows only as a CSV code block with
the same 20 columns, then list the rows that should be deleted.

Check for:
 1. Column count and header exactly as the template; one letter in correct_answer.
 2. Each topic has 50 questions (15 easy, 20 medium, 15 hard) and the topic name is spelled identically every time.
 3. Every question has a concept from the topic's list; each concept has at least 3 questions.
 4. Exactly one defensible correct option; reject any question where two options could be right.
 5. Wrong options that are off-topic, silly, untrue only in the document, or different in length or style from the right one.
 6. Explanations that are generic, repeated, or do not teach the idea; repeated stem patterns; near-duplicate questions.
 7. Facts the source does not support; a source_quote that is not word for word in the source.
 8. The characters < or >, HTML, line breaks inside fields, "the answer is" in question_text.
 9. TRUE_FALSE rows: option_a True, option_b False, C and D empty.
10. Personal or confidential details; questions that need a picture, outside knowledge, or another question.
11. Questions that ask what the document "lists" instead of testing the knowledge.
```

---

## What the AI decides and what you decide

| You decide | The AI works out |
|---|---|
| The level (one question) | Source kind, title, grade, subject, language, audience, the topics, the concepts, the question counts, the difficulty spread |

## Rules of thumb
- One source per chat. A batch is 100 questions (two topics); a grade-subject has dozens of topics, so expect many batches. Start a new chat and use RESUME when a chat gets long.
- Look at the first topic map and the first batch before saying `next` again. If the topics are too big (chapters) or too small (single facts), say so and ask it to redo the map.
- Use your Gemini account within its normal limits and terms of service.

---

## Check a file on your computer (before it goes to an SME)

After saving the AI's output as `.csv` or `.xlsx` (sheet named QUESTIONS), run in the project folder:

```
npx tsx scripts/check-question-file.ts "path/to/file.csv" --problems problems.csv
npx tsx scripts/check-question-file.ts batch1.txt batch2.txt batch3.txt --source "path/to/curriculum.pdf"   (several batches checked together)
npx tsx scripts/check-question-file.ts "path/to/file.csv" --source "path/to/curriculum.pdf"
npx tsx scripts/check-question-file.ts "path/to/file.csv" --rebalance balanced.csv
npx tsx scripts/check-question-file.ts "path/to/sponsor-file.xlsx" --scope sponsor
```

- **Rules and quality** (always): row counts, every rule problem with its row number, and batch warnings: templated explanations, repeated question patterns, uneven answer letters, the correct option being the longest, questions that ask what "the curriculum" lists, and wrong options that look borrowed from another topic.
- **Topic blocks** (always): a table of every topic with its question count, easy/medium/hard split and number of concepts; warnings for topics that are not 50 questions (`--topic-block N` changes the target), lopsided difficulty, fewer than 3 concepts, and the same topic named two ways.
- **`--source`**: checks every `source_quote` against the real text of your PDF or text file (word for word, near, or not found), learns the page offset between printed and physical pages and flags rows that depart from it, and checks that each indicator code exists in the curriculum.
- **`--rebalance`**: writes a copy with the correct-answer letters evened out by moving whole option texts. It leaves true/false rows and any question whose wording points at an option position ("Option B", "Both A and B") alone.

Nothing is uploaded anywhere. "Can load: YES" means the file passes every rule; the admin loading screen (tracker L4) runs the same checks.
