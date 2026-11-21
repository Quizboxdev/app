# SPK-1117A closeout: every issue the simulation agents found, and where it stands

Run SPK-1117A (8 agents, Preview, 17 November 2026) logged 38 issues. "Row" is the row number in the triage register
(`Spark_Orchestration\RESULTS\SPK-1117A_Issues_Triage.xlsx`). This page is the evidence that each one was dealt with, so a reviewer, a funder or a
journalist asking "what did you do about what testers found?" gets a straight answer.

| Row | Issue (short) | Outcome | Where |
|---|---|---|---|
| 1 | Teacher assignments invisible to students | Cause was the wrong class chosen; real gaps fixed: late joiners now receive open assignments, wizard warns about an empty class | #110, migration 20261118110000 (Preview, Production) |
| 2 | Question Banks / Editorial Review offline error | Access rules evaluated once per query | #111, migration 20261119100000 (Preview, Production) |
| 3, 4 | Past due date / past closing time accepted | Refused with a message | #114 |
| 5 | Admin counts disagree, zero counts | Explained (75 seeded questions); counts fixed | #115 |
| 6 | Sponsor verification not visible, no queue | Status on the sponsor dashboard; verification queue; decline needs a reason; sponsor notified; audited | #126, migration 20261121120000 |
| 7 | Unfinished work empty | Assignment drafts and started practice appear | #112 |
| 8 | Challenge 1 Q2 explanation contradicts the key | Fixed on Preview (fixture) | script `preview_fix_challenge_q2.sql` |
| 9, 17 | "You are offline" banner; search hidden behind it | Banner was a test-browser artifact (owner sees none); search list now rises above any banner | closed; #123 |
| 10 | Menu names differ from page headings | Page headings match the menu (the guides and videos use the menu names) | #123 |
| 11, 12 | Duplicate / truncated topic names, "1 questions" | Strand shown on repeated names; titles and plural fixed | #113, migration 20261119110000 (Production) |
| 13, 14, 18, 21, 26, 27, 33 | Results time taken, title limit message, leaderboard rank twice, admin on /teacher, empty-title hint, bell badge, account subtitle | Fixed | #115 |
| 15 | Student class card lacks teacher, counts, "already joined" | "Already joined" in #115; teacher name, learner count and open work in #124 | #115, #124, migration 20261121100000 |
| 16, 36 | Pricing and Subscribe disagree | Same sentences on both pages; free sessions shown on Subscribe. The remaining difference is data: Production's price list has no prices yet | #127; owner sets prices in Admin > Prices |
| 19, 34, 35 | Disabled Start unexplained; "free account" prompt when signed in; assessment results CTA | Fixed | #114 |
| 20 | School directory has no single-school form | Add one school (same checks as a user submission, approved at once) | #128 |
| 22 | Admin challenge / competition lists lack search, filter, sort | Search, status filter and sort; links from Competition Operations | #128 |
| 23 | Class card has no detail/rename, 200-character names | Detail, rename, 80-character cap; rename uses the same update right as Archive | #115 |
| 24 | Teacher sees SME and Administration menus | By design: the groups appear only for people holding those duties, and the route guard uses the same flags. No change | closed |
| 25 | Other-role page flashes before redirect | No page of another role is rendered while access is read | #115, #123 |
| 28 | Learner help omits menu items | Help centre refreshed (27 to 40 guides) and corrected | Production, #121 |
| 29 | "B5" and "Class 5" | Account shows "Class 5 (B5)" | #123 |
| 30 | Sponsors help tab, family steps differ from screen | Guides corrected; parent promotion hidden until the Family workspace is on | #121 |
| 31 | Pending request prints the invitee's email | Masked address, shown for 14 days, same list whether or not the email has an account | #125, migration 20261121110000 |
| 32 | Sponsor dashboard says competitions cannot be created | Says the sponsor workspace is not open and links to Start a competition | #123 |
| 37 | No approved questions beyond B4 to B6 | Content, not code: question loading and approval in progress | Load runbook |
| 38 | Support tickets | Handled during the run | closed |

## What still needs a person's eyes
These cannot be proved by tests. Each takes a minute in a normal browser (not a Spark browser).

1. Student (Preview): the menu and page names agree (Assignments, Compete, Challenges, Create and share); Account shows "Class 5 (B5)".
2. Student with a class: the card shows the teacher, learners and open work (after migration 20261121100000).
3. Teacher: rename a class from its card; open /admin and /sponsor and confirm no flash of those pages.
4. Parent: send a link request to a real email and to a made-up one; both show the same masked line.
5. Sponsor and super administrator: verify and decline an organisation; the sponsor sees the result and a notification.
6. Super administrator: Add one school; find it in the student school picker.
7. Any creator with more than three challenges: the search, filter and sort bar appears and works.
8. Search box while the offline banner is showing (turn the network off in the browser): the result list is readable.
9. Pricing and Subscribe: the same sentence about prices; Subscribe shows free sessions left.

## Not covered by the simulation
Classroom load (the first burst never ran), the sponsor workspace (off in Production), the Family workspace (off in Production), and anything that needs real money.
