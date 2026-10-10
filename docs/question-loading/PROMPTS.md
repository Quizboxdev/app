# Question-loading prompts for Gemini (or any AI chat)

How to use: open a chat, upload the document (curriculum PDF, or the sponsor's document), paste **Prompt A** (curriculum) or **Prompt B** (sponsor pool), answer its short questions, and let it produce the file in batches. Save the result as `.csv` (UTF-8) or paste it into `QuizBox_Question_Load_Template.xlsx`, sheet QUESTIONS. Then use **Prompt C** to check each batch before loading.

The loader (tracker H2–H3) rejects any row that breaks these rules, so the prompts state the rules the database enforces.

---

## Prompt A: curriculum questions (Basic / JHS / SHS)

```
You are a senior Ghanaian curriculum assessment writer building a question bank for QuizBox.
I have uploaded an official curriculum document. Work ONLY from it.

STEP 1: ASK ME (one short list, then wait):
  - level (PRIMARY, JHS or SHS), grade (e.g. B7), subject
  - which strands/sub-strands to cover (default: all in the document for that grade and subject)
  - questions per learning indicator (default 10)
  - difficulty mix (default: 30% easy, 50% medium, 20% hard)

STEP 2: ANALYSE. List the structure you found as a table: strand, sub-strand, content standard,
indicator code, indicator text. Use the indicator codes EXACTLY as printed in the document.
Do not invent indicators. Wait for me to say "go".

STEP 3: WRITE THE QUESTIONS. Output ONLY a CSV code block, in batches of 25 rows, then say
"Batch n done, x rows remaining. Say next." Use exactly this header on the first batch only:

level,grade,subject,strand,sub_strand,indicator_code,topic,difficulty,cognitive_level,answer_type,question_text,option_a,option_b,option_c,option_d,correct_answer,explanation,source_reference,source_quote

FORMAT RULES (rows that break these are rejected on loading):
  1. Every field in double quotes. A double quote inside a field is written as two double quotes.
     One row per line. No line breaks inside a field.
  2. level = PRIMARY, JHS or SHS. grade, subject, strand, sub_strand, indicator_code as in the document.
  3. difficulty = easy, medium or hard (lower case only).
  4. cognitive_level = Remember, Understand, Apply, Analyse or Evaluate.
  5. answer_type = SINGLE_CHOICE or TRUE_FALSE. For TRUE_FALSE: option_a is True, option_b is False,
     option_c and option_d are empty, and correct_answer is A or B.
  6. correct_answer = one letter A, B, C or D. Spread the correct letters evenly across each batch.
  7. Plain text only. No HTML. Do NOT use the characters < or >; write "less than" / "greater than".
     Write maths in words and plain symbols (3/4, 2 x 5, 50%).
  8. Never write "the answer is", "correct answer" or "answer key" inside question_text.
  9. source_reference = page or section of my document the question comes from. source_quote = a
     short phrase (max 200 characters) copied word for word from my document.

QUALITY RULES:
  - Every question tests exactly its indicator, at the stated difficulty and cognitive level.
  - Every question stem is different. Do not reuse a sentence frame with only a word swapped.
  - Exactly ONE option is correct. The other options are wrong but believable: common
    misconceptions about the SAME topic, the same type of statement, similar length.
    Never use unrelated topics as wrong options. No "All of the above", "None of the above"
    or "Both A and B".
  - The explanation is written for this question: why the right answer is right and what the most
    tempting wrong option gets wrong. Never use a generic sentence like "The correct response states
    the accepted idea".
  - Use familiar Ghanaian contexts (cedis, local foods, places, farming, markets) where natural.
  - Age-appropriate language for the grade. No trick questions or double negatives.
  - If the document does not give enough material for the number I asked for an indicator, write
    fewer questions for it and tell me. Never invent facts the document does not support.

STEP 4: After the last batch, give a one-paragraph self-check: row count per indicator, difficulty
counts, correct-letter counts, and any rows you are unsure about.
```

---

## Prompt B: sponsor document pool (context-based competition)

```
You are an assessment writer creating a competition question pool for a QuizBox sponsor.
I have uploaded the sponsor's document. Every question must come from that document ONLY.
Do not use outside knowledge. If the document does not say it, do not ask it.

STEP 1: ASK ME (one short list, then wait):
  - sponsor name, competition audience (e.g. JHS learners, adults, staff), and language
  - how many questions in total (default 100)
  - difficulty mix (default: 30% easy, 50% medium, 20% hard)

STEP 2: ANALYSE. List the document's chapters/sections and the topics inside each, with page
numbers. Show how many questions you plan per topic (spread them evenly). Wait for me to say "go".

STEP 3: WRITE THE QUESTIONS. Output ONLY a CSV code block, in batches of 25 rows, then say
"Batch n done, x rows remaining. Say next." Use exactly this header on the first batch only:

level,grade,subject,strand,sub_strand,indicator_code,topic,difficulty,cognitive_level,answer_type,question_text,option_a,option_b,option_c,option_d,correct_answer,explanation,source_reference,source_quote

FIELD RULES FOR A SPONSOR POOL:
  - level = SPONSOR. Leave grade, subject and indicator_code EMPTY.
  - strand = the document's chapter or part. sub_strand = its section. topic = the specific topic tested.
  - source_reference = page or section number. source_quote = REQUIRED: a phrase of at most 200
    characters copied word for word from the document that proves the answer.
  - Everything else follows the format and quality rules below.

FORMAT RULES (rows that break these are rejected on loading):
  1. Every field in double quotes. A double quote inside a field is written as two double quotes.
     One row per line. No line breaks inside a field.
  2. difficulty = easy, medium or hard (lower case only).
  3. cognitive_level = Remember, Understand, Apply, Analyse or Evaluate.
  4. answer_type = SINGLE_CHOICE or TRUE_FALSE. For TRUE_FALSE: option_a is True, option_b is False,
     option_c and option_d are empty, and correct_answer is A or B.
  5. correct_answer = one letter A, B, C or D, spread evenly across each batch.
  6. Plain text only. No HTML. Do NOT use the characters < or >.
  7. Never write "the answer is", "correct answer" or "answer key" inside question_text.

QUALITY RULES:
  - Every stem is different. Exactly ONE option is correct; the others are believable wrong
    options from the SAME document or topic, of similar length. No "All/None of the above".
  - The explanation says why the answer is right, citing the document, and what the tempting wrong
    option gets wrong. Never generic.
  - Questions must make sense on their own to someone who has read the document, without
    saying "according to the passage" more than occasionally.
  - Vary the cognitive level: mostly Remember/Understand, some Apply, a few Analyse.

STEP 4: After the last batch, give a one-paragraph self-check: row count per topic, difficulty
counts, correct-letter counts, and any rows you are unsure about.
```

---

## Prompt C: check a batch before loading

Paste this with a batch of rows (and the source document still attached):

```
Check the rows I paste against these QuizBox rules and the uploaded document. For each problem,
reply with: row number, problem, and a corrected row. Output corrected rows only, as a CSV code block
with the same columns. Then list rows that should be deleted.

Check for:
  1. Header and column count exactly as the template; one correct letter in correct_answer.
  2. Exactly one defensible correct option; reject questions where two options could be right.
  3. Wrong options that are off-topic or obviously silly; options that are not similar in length.
  4. Generic or repeated explanations; repeated stem patterns.
  5. Facts not supported by the document, or a source_quote that is not word for word in it.
  6. The characters < or >, HTML, line breaks inside fields, "the answer is" in question_text.
  7. TRUE_FALSE rows: option_a True, option_b False, C and D empty.
  8. Duplicate or near-duplicate questions.
```

---

## Quick rules of thumb
- Ask for **one grade and one subject per chat**, and **25 rows per batch**. Long single answers get cut off.
- Run Prompt C on every batch. It is free and catches most faults before an SME sees them.
- An SME still reads a sample of every batch. The loader will also flag templated explanations, repeated stems and off-topic options.
- Use your Gemini account within its normal limits and terms of service.

---

## Check a file on your computer (before it goes to an SME)

After saving the AI's output as `.csv` or `.xlsx` (sheet named QUESTIONS), run in the project folder:

```
npx tsx scripts/check-question-file.ts "path\to\file.csv" --problems problems.csv
npx tsx scripts/check-question-file.ts "path\to\sponsor-file.xlsx" --scope sponsor
```

It prints row counts by level, grade, subject, difficulty and answer letter, every rule problem (with the row number), and batch warnings (templated explanations, repeated question patterns, uneven answer letters, off-topic wrong options). Nothing is uploaded anywhere. "Can load: YES" means the file passes every rule; the admin loading screen (tracker L4) runs the same check.
