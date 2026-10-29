# 11 - Beta tester guides (for interns)

Written for: interns testing QuizBox on **Preview** with synthetic accounts. Read section 0 first. Journeys use the real menu and button names from the app.

**Screenshots.** Real screenshots exist only for the public pages (folder `evidence/public/screenshots/`). Signed-in screens could not be captured in this audit (no test accounts). Where a step says **[CAPTURE]**, take the screenshot during your run and save it as `evidence/<role>/<journey id>-<step>.png`; do not paste an imagined or mocked-up screen into a report.

**Honesty note.** The public-page journeys (section 1) were run by the author. The signed-in journeys were written from the code, menu labels and existing guides and **have not yet been run**, because no test accounts were available. If a step does not match what you see, report it as a "Documentation" problem with a screenshot; that is useful, not a failure on your part.

## 0. Before you start

**Where to test.** Only on the Preview site with the Preview database. Never create accounts, pay, refund or delete anything on `www.quizbox.io`. If you are unsure which site you are on, look at the address bar: Preview addresses end in `vercel.app`.

**Test accounts.** One account per role, created by the team lead and named `qa-student`, `qa-teacher`, `qa-school`, `qa-sponsor`, `qa-sme`, `qa-finance`, `qa-owner`, with a password the team lead gives you. Do not use a real person's details or a real phone number for mobile money; for payment tests use Paystack **test** cards only (see `docs/beta-testing/NEW_FEATURES_WALKTHROUGH.md`).

**Devices.** Test every journey at 390 px wide (phone) and at desktop width. In Chrome: right-click > Inspect > the phone icon > choose "iPhone 12 Pro" (390 px). Also test one journey on a real Android phone if you have one.

**Collect evidence.** For every failure: a screenshot of the whole screen (include the address bar), the time, the account used, and what you clicked. For a slow or broken page open Inspect > Console and screenshot any red lines.

**Report a problem** with this template (one per problem):

```
Title: <page> - <what went wrong in 8 words>
Environment: Preview / date / browser + version / device or width
Account and role: qa-teacher (Teacher)
Journey ID and step: T3 step 4
Steps I did: 1. ... 2. ... 3. ...
Expected: ...
Actual: ...
How often: every time / 2 of 3 / once
Evidence: file names of screenshots
Severity guess: blocks the task / slows me down / looks wrong / minor
```

**Reset test data safely.** Only the team lead resets data. Never delete from the database yourself. For a clean quiz run, ask for a new test student instead of editing an old one. Names of anything you create should start with `QA-` so it can be found and removed.

**Pass / fail.** A step passes only if what you see matches **Expected** exactly. If something is unclear, write FAIL-UNCLEAR and say why; do not guess a pass.

---

## 1. Visitor (no account) - run on any site, read-only

| ID | V1 Understand the offer and find prices |
|---|---|
| Objective | A first-time visitor can say what QuizBox is, who it is for and what it costs within one minute |
| Account | None |
| Preconditions | Phone width 390 px |
| Steps | 1. Open the home page. 2. Read the first screen. 3. Tap **Start practising, free** and then go back. 4. Open the menu (three lines) and tap **Pricing**. 5. Find the weekly and monthly learner prices. |
| Expected | Home hero reads "Learn. Practise. Compete." with two buttons. Pricing shows "Weekly GHS 5 per week", "Monthly GHS 10 per month", "Term (90 days) GHS 25", "Yearly GHS 90". Each price also shows its Coins. No sideways scrolling. |
| Screenshot | `evidence/public/screenshots/home-390-fold.png`, `pricing-390-fold.png` |
| Pass | All five steps work and the prices are found in under 60 seconds |
| Common failures | Orange "Coins" chips hard to read (known: UX-001); long page |

| ID | V2 Contact the team |
|---|---|
| Steps | 1. Open **Contact**. 2. Read the four routing cards. 3. Open **Sponsor interest** and back. 4. Find the general message form. 5. Do **not** submit on production. On Preview, send a message "QA test" with a PNG attached. |
| Expected | Preview: a reference number appears. |
| Screenshot | `contact-390-fold.png` |
| Common failures | Form is far down the page (known: UX-010) |

| ID | V3 Wrong address |
|---|---|
| Steps | Open `/no-such-page`. |
| Expected today | A bare "404 This page could not be found." with no links (known: UX-021). After the fix: links to Home and Help. |
| Screenshot | `not-found-390.png` |

| ID | V4 Keyboard only |
|---|---|
| Steps | On the home page press Tab 15 times without the mouse. |
| Expected | First stop "Skip to content"; focus ring visible every time; focus never disappears. |

## 2. Student (qa-student)

| ID | S1 Sign up and onboarding (Preview only) |
|---|---|
| Steps | 1. Open `/login`, tap **Create account**. 2. Sign up with a QA email. 3. On the onboarding screen fill **Full name**, **Country**, **I am a** = Student, **Education level**, **Grade / class**, tick subjects, **Continue**. |
| Expected | Lands on the student Home. The browser tab should say the page name (known gap UX-003). Terms and Privacy acceptance prompt appears once. |
| Pass | You reach Home without an error and the menu shows Home, Practise, Assignments, Compete, Challenges, My challenges, Create and share. |
| Capture | [CAPTURE] onboarding form; student Home |

| ID | S2 Practise and review a result |
|---|---|
| Steps | 1. Menu > **Practise**. 2. Choose a subject and topics, start. 3. Answer a question and tap **Check answer**. 4. Read Correct / Not quite, your answer, the correct answer, **Why**. 5. Go through to the last question and tap **Finish practice**, then **Confirm submission**. 6. Open **Progress**. |
| Expected | Feedback appears after Check answer; the number answered in the progress bar goes up; the result page shows your score and topics. |
| Pass | Score is shown and **Progress** lists the topic. |
| Capture | [CAPTURE] feedback panel; submit confirmation; result page |

| ID | S3 Weak network (high value) |
|---|---|
| Steps | 1. Start a 5-question practice. 2. Open Inspect > Network, set **Offline**. 3. Choose an answer on question 2. 4. Set **No throttling** again. 5. Answer question 3 and finish. 6. Open the result and compare to what you chose. |
| Expected (target) | A message says you are offline; the answer saves when back online; the result matches your choices. |
| Known risk | UX-011: the warning may stay red forever and the question-2 answer may be recorded as unanswered. **Report exactly what you see.** |
| Capture | [CAPTURE] red banner; result page |

| ID | S4 Resume an interrupted attempt |
|---|---|
| Steps | Answer 3 of 6 questions, close the tab, reopen the same attempt from **Assessments**. |
| Expected | Answers kept; timer continues from the saved time. Known: opens at question 1 (UX-012). |

| ID | S5 Join a challenge by link |
|---|---|
| Steps | Open a challenge link given by your lead, signed out. Sign in when asked. |
| Expected | After sign-in you return to the challenge (the address keeps `next=`). |

## 3. Teacher (qa-teacher)

| ID | T1 Class and learners |
|---|---|
| Steps | 1. Sign in. 2. Menu > **Classes**, create "QA Class 1". 3. Share the class code; join with qa-student in another browser. |
| Expected | Student appears in the class. |

| ID | T2 Find questions and assign |
|---|---|
| Steps | 1. **Question Banks**: find an approved set. 2. **Assignments** > create, choose class and due date, **publish**. 3. As qa-student open **Assignments** and complete it. |
| Expected | Student sees it; teacher sees the submission in **Gradebook** and **Dashboard**. |

| ID | T3 Read class mastery and act |
|---|---|
| Steps | On the teacher **Dashboard** open **Weak Indicators**, choose a row, select learners, create remedial work. |
| Expected | A list of affected learners with pages; remedial assignment is created. |
| Known | Dashboard has no top-level heading (UX-005). If one request fails, the whole page is replaced by an error (UX-014): note whether a **Try again** button exists. |

| ID | T4 Young learners (under 13) |
|---|---|
| Steps | **Young learners**: add a managed learner, reset the PIN, archive. |
| Expected | No email needed; learner cannot see payment options. |

## 4. School administration (qa-school)

| ID | C1 | Steps | Expected |
|---|---|---|---|
| School overview | 1. Open the school link, **Overview**. 2. **Classes**, **Teachers**, **Learners**, **Performance**. | Each page loads with the school menu (Overview, Classes, Teachers, Learners, Performance, Challenges, Competitions). | Numbers match what you created in T1. |

## 5. Subject matter expert (qa-sme)

| ID | R1 Review queue |
|---|---|
| Steps | 1. Menu > **SME Reviews**. 2. Open an assigned question. 3. Check source reference and curriculum alignment. 4. Approve one, reject one with a reason, request a revision on one. |
| Expected | Status changes; the item leaves your queue; a reason is required on reject. |
| Capture | [CAPTURE] review screen; decision confirmation |

## 6. Sponsor (qa-sponsor)

| ID | P1 |
|---|---|
| Steps | **Dashboard** > **Challenges**: draft a challenge, choose audience, **Workspace** (if the flag is on) add a source. |
| Expected | Draft is saved; **Unfinished work** lists it; nothing publishes without approval. |

## 7. Admin / Owner / Finance (qa-owner, qa-finance)

| ID | A1 Exports |
|---|---|
| Steps | **Export data**: Payments, last 30 days; preview, download Excel and CSV. Finance account: confirm Accounts and Audit log are not offered. |
| Expected | Preview count shows; Excel opens with dates and a filter row; finance sees money datasets only. |

| ID | A2 Payment checks |
|---|---|
| Steps | **Payment checks** > **Check now**. Start a Marketplace purchase with a Paystack test card, close the page, check again after 3 minutes. |
| Expected | "All clear" or a short list; unpaid attempts only show when the box is ticked. |

| ID | A3 Content path |
|---|---|
| Steps | **Load Questions** (20 synthetic questions) > **Approve Batches** > **Content Quality**. |
| Expected | Batch moves to Approved; questions appear in Question Banks. |

| ID | A4 Menu per capability |
|---|---|
| Steps | Sign in as finance, support, content admin, owner and count menu links per account. |
| Expected | Each sees only their tools. Owner sees up to 39 links (UX-017): note how long it takes to find "Payment checks". |

## 8. Regression checklist (run after every release)

- [ ] Public: `/`, `/pricing`, `/help`, `/contact`, `/login` at 390 px: no sideways scroll, titles distinct
- [ ] Sign in / sign out for each role lands on the right home page
- [ ] Student: Practise end-to-end (S2) and weak-network (S3)
- [ ] Teacher: assign and read a submission (T2)
- [ ] Owner: export one dataset; Payment checks shows "All clear"
- [ ] Offline test: message says you are offline
- [ ] Keyboard-only: skip link is the first Tab stop on every page
