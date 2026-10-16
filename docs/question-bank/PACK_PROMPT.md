# Question generation: the constant prompt

You never edit this prompt. The subject, grade and topics come from the **pack sheet** you attach (one `.txt` per chat, from `Questions Bank/_work/packs/`). Swap the attached sheet, paste the same prompt in a new chat, and go.

## Mode A: Gemini chat (one pack per chat)

1. New chat. Attach one pack sheet, for example `B4_Mathematics_P01.txt`.
2. Paste the prompt below.
3. It writes two topics (100 questions) per reply. Say `next` until it says `PACK COMPLETE`. A 10-topic pack is 5 replies.
4. Save each reply's CSV as one file in `Questions Bank/_work/returns/` (any name, `.csv` or `.txt`; code fences are fine).
5. Run `python scripts/question-bank/bank.py assemble`. Accepted questions go to `Questions Bank/<Level>/<Grade>_<Subject>_<count>.csv`; rejects and gaps are listed in `_work/`.

```
ROLE
You are a senior examiner writing a question bank for QuizBox, a Ghanaian school learning platform. The attached pack
sheet is your ONLY source. It lists the topics (each is one learning indicator) with their printed indicator code,
wording, exemplars and page. Write real, examinable questions of the kind a good teacher or an external examiner would set
on this topic. Write every question individually. Never fill a sentence frame with swapped names or numbers, and never
generate rows by pattern. If you cannot keep the quality up, write fewer rows and say so.

START
Read the pack sheet. Reply with ONE line: "PACK <id>: <n> topics, <n x 50> questions. Starting with topics 1 and 2."
Then write topics 1 and 2. Do not ask me anything. After each reply wait for me to say "next". When all topics are done,
finish with the line PACK COMPLETE.

WHAT TO WRITE, PER TOPIC: exactly 50 different questions
 - Difficulty: 15 easy, 20 medium, 15 hard.
 - Cognitive level: Remember 8, Understand 16, Apply 14, Analyse 8, Evaluate 4.
 - Difficulty must match the cognitive level, because the platform checks it and rejects a row that breaks it:
     easy   = Remember or Understand (recognise, name, state, simple meaning)
     medium = Understand, Apply or Analyse (use the idea in a familiar situation, compare, interpret, classify, one or two steps)
     hard   = Apply, Analyse or Evaluate (unfamiliar situation, multi-step reasoning, calculation with several steps, cause and effect,
              judge between explanations). Never mark a recall question as hard and never mark an Evaluate question as easy.
 - TRUE_FALSE for at most 5 of the 50. Everything else is SINGLE_CHOICE with four options.
 - Split each topic into the 3 to 8 separate concepts it contains, name each concept in the "concept" column, and give every concept
   at least 3 questions and no concept more than a quarter of the 50. Write easy questions first, then medium, then hard.
 - Every question stands alone: no "the previous question", no dependence on order, no picture, table or diagram the learner cannot see.
 - A different scenario, example or angle for every question. Changing only names or numbers is not a new question.
 - Real examination style: the question tests the SUBJECT KNOWLEDGE or SKILL the indicator describes, in a school or everyday Ghanaian
   situation where natural (markets, farms, schools, cedis, local foods, football). Calculations are fully stated and correct.
 - NEVER write a curriculum-header question. Do not ask about the document, the strand, the sub-strand, the indicator, the code, the
   exemplars, "what the curriculum says", "what this topic is about" or "which topic covers...". The learner never sees the curriculum.
   A question that only repeats a heading or asks the learner to recognise a title is a failure.

ANSWERS AND OPTIONS
 - Exactly ONE option is correct and defensible. The three wrong options are plausible: each reflects a real misconception, a mixed-up
   term, a wrong step or a wrong unit that a learner who half understood the topic could choose. A learner who has not learned the topic
   must not find the answer by common sense. No absurd options, no extreme words (always, never, completely, instantly, zero), no
   "All of the above", "None of the above" or "A and B".
 - All four options are nearly the same length (within 3 words) and the same style. The correct option must be the longest in no more than
   1 question in 3. Spread the correct letter evenly across A, B, C and D (about 12 or 13 each per 50).
 - Hard questions need wrong options as believable as the right one. Check every wrong option is really wrong in the real world.
 - The explanation teaches in 20 to 60 words: state the idea, say why the answer is right, give a tiny example where it helps, and say what
   the most tempting wrong option gets wrong. Never write a generic sentence such as "this is the correct response".

NO DUPLICATES
 - Within the pack and across the whole subject, never write the same question twice, never reword one, and do not reuse the same correct
   answer text more than 3 times in a topic. If you run out of genuinely different questions on a topic, write fewer and say so in the report.

OUTPUT: two CSV code blocks per reply (one per topic), then a one-line report
Header (first block of the first reply only):
level,grade,subject,strand,sub_strand,indicator_code,topic,concept,difficulty,cognitive_level,answer_type,question_text,option_a,option_b,option_c,option_d,correct_answer,explanation,source_reference,source_quote

How to fill the columns, copied from the pack sheet exactly (never retype or invent a code):
 level = LEVEL line (PRIMARY, JHS or SHS) | grade = GRADE | subject = SUBJECT | strand, sub_strand = from the topic block
 indicator_code = INDICATOR CODE | topic = TOPIC NAME | concept = one of your concepts for the topic
 difficulty = easy, medium or hard | cognitive_level = Remember, Understand, Apply, Analyse or Evaluate
 answer_type = SINGLE_CHOICE or TRUE_FALSE | correct_answer = A, B, C or D
 source_reference = "p" + PAGE | source_quote = one continuous passage copied word for word from that topic's INDICATOR or EXEMPLARS lines (max 200 characters)

Format rules (a row that breaks one is rejected):
 1. Every field in double quotes; a double quote inside a field is written as two double quotes. One row per line, no line breaks inside a field.
 2. TRUE_FALSE: option_a is True, option_b is False, option_c and option_d empty, correct_answer A or B.
 3. Plain text only. No HTML, no LaTeX, and do not use the characters < or > (write "less than", "greater than"). Maths in words and plain symbols (3/4, 2 x 5, 50%, m/s).
 4. Do not write the answer, "answer key" or "correct answer" inside the question. Do not create IDs or numbers for the rows.
 5. Spell topic and concept names identically every time.

After the two code blocks write ONE line: "Topics <a> and <b> done: <n> rows each. Short: <topic and reason, or none>." Then wait for "next".
```

## Top-up prompt (after the checker reports gaps)

`bank.py assemble` writes `_work/reports/<Grade>_<Subject>_gaps.csv`: for each topic, how many more questions and how many easy, medium, hard it still needs. Start a new chat, attach the same pack sheet and the gaps file, and paste:

```
Use the same rules as before (the attached pack sheet is the only source). The attached gaps file lists topics that are short.
For each listed topic write ONLY the missing questions: need_easy easy, need_medium medium, need_hard hard. Do not repeat any
question you wrote before; make each one cover a new angle of the topic. Same CSV format, header on the first block only,
two topics per reply, wait for "next", finish with TOP-UP COMPLETE.
```

## Mode B: agent loop (Argon, Codex or any agent with file access)

Hand the agent this brief once. It then runs unattended per unit and only stops on a hard error.

```
GOAL: fill the QuizBox question bank. Work through Questions Bank/_work/WORK_QUEUE.csv for ACCOUNT=<A1..A8> in the order given
(Primary, then JHS, then SHS), pack by pack.

FOR EACH PACK
 1. Read the sheet named in the "sheet" column (under Questions Bank/_work/). It is the only source.
 2. Write the 500 questions (10 topics x 50) following docs/question-bank/PACK_PROMPT.md exactly (the prompt between the code fences).
 3. Save them as one CSV with the header row to Questions Bank/_work/returns/<pack_id>.csv.
 4. Run: python scripts/question-bank/bank.py assemble
 5. Read Questions Bank/_work/reports/<Grade>_<Subject>_report.txt and _gaps.csv. If any topic is short or any rows were rejected,
    write ONLY the missing questions (the top-up rule above), save as returns/<pack_id>_topup.csv, run assemble again. Repeat up to 3 times.
 6. Set the pack's status in WORK_QUEUE.csv to DONE (or NEEDS_REVIEW with a one-line note if still short) and go to the next pack.

NEVER: invent indicator codes, edit existing rows in the final files, delete anything in Questions Bank, use outside question banks or past
papers, ask a curriculum-header question, or skip the checker. Stop and report if the checker rejects more than 20 percent of a pack twice in a row.
```

## What the checker enforces

| Rule | Action |
|---|---|
| Valid columns, difficulty, cognitive level, answer type, correct letter | reject the row |
| Difficulty and cognitive level must agree (recall never hard, evaluate never easy) | reject the row |
| Curriculum-header wording (strand, indicator, "according to the curriculum", printed codes) | reject the row |
| Same wording already in the bank, or 85 percent word overlap inside a topic | reject the row |
| Duplicate options, "all of the above", forbidden characters, answer wording | reject the row |
| Indicator code not in this unit's packs | reject the row |
| 50 per topic and the 15/20/15 mix | gap file, so the top-up asks for exactly what is missing |
| Correct option longest more than half the time, one letter above 40 percent, more than 5 TRUE_FALSE, same correct answer over 3 times | warning |

## Limits you should know
- The checker cannot judge whether a question is **true**. An SME reviewer still reviews every question, and `scripts/check-question-file.ts` still verifies each `source_quote` against the PDF before loading.
- Difficulty is checked by rule (the level pairing and counts), not by how hard a question really is. Reviewers will move some.
- Near-duplicate detection is word overlap. A reworded question with new words can pass; the SME pool catches those.
