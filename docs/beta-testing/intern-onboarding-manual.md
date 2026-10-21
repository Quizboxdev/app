# QuizBox beta tester manual (for interns)

Read this once, then work through `test-scenarios.md`. You do not need to know how to code.

## 1. What QuizBox is
A learning and competition platform for Ghanaian school curricula. Learners practise questions; teachers set work for classes; anyone with an account can create and share quizzes (challenges are timed; competitions have rounds); sponsors run branded quizzes; admins manage content and prices.

## 2. Scope of this beta
In: everything in `test-scenarios.md`. Out: real payments, real children's data, the production site, load or speed testing, trying to break into the system. If something is not in the scenarios, you may look, but do not change settings.

## 3. Set up
1. Use the **Preview** address your lead gives you (never `www.quizbox.io`).
2. Use Chrome on a laptop. For phone tests, use a real phone or Chrome's device mode (F12, then the phone icon) at 390 px wide.
3. Create a folder `evidence/<your name>/<date>` for screenshots.

## 4. Your accounts
Your lead gives you the accounts in `tester-account-matrix.md` through the team password manager. Never write passwords in a document, chat or screenshot. Do not use your own email or a real school's data.

## 5. Responsible use and data protection
Only use the test accounts and made-up names. Do not enter real children's names. Blur or crop anything personal before saving a screenshot. If you see real personal data on Preview, stop and tell your lead at once (that is a critical issue).

## 6. Understand before you test
Read the scenario's "Expected" line first. If you are unsure what should happen, ask; do not guess.

## 7. Doing a test
Follow the steps exactly, one by one. Note the time. Do not skip steps even if you think they are obvious.

## 8. Screenshots
Press Windows+Shift+S, drag over the page including the address bar, and save as `SCENARIO-ID_step_what-it-shows.png` (for example `STU-02_3_challenges-page.png`). Take one before the action and one after. Show the whole window so the address and the time are visible.

## 9. Actual vs expected
In `test-case-register.csv` write what really happened in the **actual_result** column. PASS only when it matches Expected and you have the evidence. Use FAIL when it does not match, BLOCKED when you could not reach the step (say why), NOT RUN if you did not try.

## 10. Reproducing a bug
Reload and repeat the steps from the start, ideally in a private window. Note whether it happens every time. A bug you can repeat three times is worth reporting even if small.

## 11. Severity
- **P0 Critical:** private data of another person visible; money wrong; site down for everyone.
- **P1 High:** a main journey cannot be completed (sign in, practise, join, pay, submit).
- **P2 Medium:** a feature works badly or is confusing; wrong wording that misleads.
- **P3 Low:** looks untidy; small wording; small layout glitches.

## 12. Escalating
P0: message your lead immediately by phone, do not wait for the daily report. P1: tell your lead the same day. P2 and P3: in the daily report.

## 13. Retesting
When a defect is marked Fixed, repeat the exact steps on the new build. Write the result on the defect report and set status to Verified or Re-opened.

## 14. Daily report
At the end of each day copy `daily-testing-report.md`, fill it in and send it to your lead.

## 15. Finishing
Testing is complete when every scenario assigned to you is PASS, FAIL or BLOCKED (not NOT RUN), every FAIL has a defect report with evidence, and your lead signs `beta-exit-checklist.md`.

## Example of a good defect report

- **ID:** BUG-2026-001
- **Title:** Challenges link in the sidebar takes the student back to Home
- **Severity:** P1 (a main journey cannot be completed)
- **Scenario:** STU-02 | **Role:** Student | **Device:** Laptop, Chrome | **Build/URL:** Preview, 21 Oct 2026, 10:42
- **Steps:** 1. Sign in as qa.student.01. 2. Click Challenges in the sidebar.
- **Expected:** The list of open challenges opens inside the app.
- **Actual:** The page flashes and the student Home page opens. Happens every time (3 of 3).
- **Evidence:** `STU-02_2_after-click.png`, `STU-02_1_before.png`
- **Notes:** No error message. Other sidebar links work.
