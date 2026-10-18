QUESTIONS BANK

Primary\ JHS\ SHS\   FINAL question files, one per grade and subject, named <Grade>_<Subject>_<count>.csv
                     (for example B4_Mathematics_1700.csv; the number is how many accepted questions it holds).
                     Written only by: python scripts/question-bank/bank.py assemble   Do not edit by hand.

_work\packs\         one sheet per 10 topics (643 sheets, 285,600 questions at 50 per topic). Attach one sheet per chat.
_work\WORK_QUEUE.csv which account (A1 to A8) takes which pack, and its status. Fill "status" as you go.
_work\UNIT_SUMMARY.csv  questions expected per grade and subject.
_work\returns\       drop every returned CSV or TXT batch here, then run the assemble command (files move to _done).
_work\reports\       per-unit report and the gaps file used for top-ups.
_work\rejects\       rows the checker refused, with the reason.

Prompt and instructions: docs\question-bank\PACK_PROMPT.md
Rebuild the packs after the curriculum files change: python scripts/question-bank/make_packs.py

_load\                load-ready files with ONLY questions never loaded before: python scripts/question-bank/bank.py export-new
