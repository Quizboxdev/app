# Turning on the Quiz Studio (migration 20261029100000)

The website is deployed. Until you apply this database change, the studio's later steps, the reader, joining, templates, the sponsored carousel and the library counts show an error or stay empty; everything else works as before.

## 0. Check first
Supabase, project `fmgccmqxfjppqydkhaiu`, SQL editor. You should see all four names (the competitions change and the Challenges changes must already be applied):
```sql
select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('challenge_set_audience','challenge_start','qb_challenge_allowance_blocked','qb_challenge_in_audience') order by 1;
```

## 1. Apply five parts, in order
Each line copies one part. Paste into a new query, Run, expect "Success". Safe to run twice.
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\studio\studio1.sql" -Raw | Set-Clipboard
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\studio\studio2.sql" -Raw | Set-Clipboard
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\studio\studio3.sql" -Raw | Set-Clipboard
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\studio\studio4.sql" -Raw | Set-Clipboard
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\studio\studio5.sql" -Raw | Set-Clipboard
```
Verify (expect 11 rows):
```sql
select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('challenge_material','challenge_material_read','challenge_join','challenge_clone','challenge_featured','challenge_library_stats','challenge_set_reader','challenge_set_targeting','challenge_sections_set_visible','qb_challenge_reader_state','challenge_content_add') order by 1;
```

## What you get
- **Start a challenge / competition** opens a guided studio: the idea (with a live preview card that fills in as you type), the material, the audience, your logo and colour, then the question editor.
- **Material types:** story book, faith book, doctrine, corporate, marketing, textbook, article, other. Each upload is analysed into chapters, with reading time. Limits: 8 MB, about 300 pages of text, 5 documents per quiz.
- **Reader:** people who join can read the chapters you tick, in the app, before they play. Closed during a timed round; closes when the competition ends (or when it opens, if you choose). No file is ever sent: text arrives a chapter at a time, marked with the reader's name.
- **Joining** is its own step (free account; a learner's first join uses a free session).
- **My challenges / My competitions** keep finished ones; "Use as template" copies questions, rounds, prizes, look and material into a new draft with no audience and no dates.
- **Sponsored quizzes carousel** on the student and teacher homes, and a small card in the sidebar: live, public, logo set, made by a sponsor, admin or owner, matching the viewer's level. Counts of hosted material by type show on the Challenges and Competitions pages.
- Rollback: `supabase/rollback/quiz_studio.sql`, then re-apply the earlier Challenges parts as its header says.
