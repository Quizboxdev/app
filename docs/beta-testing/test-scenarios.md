# Test scenarios

Run every scenario on the Preview site with the accounts in `tester-account-matrix.md`. Record the actual result in `test-case-register.csv`. Status is PASS, FAIL, BLOCKED or NOT RUN. A PASS needs the evidence listed.

## AUTH-01: Sign up

- Role: Visitor | Risk: High | Device: Desktop
- Before you start: A new disposable test email on Preview
- Steps: 1. Open the sign-up page. 2. Choose Student and fill the form. 3. Complete onboarding.
- Expected: You land on the student home page; the sidebar shows your name and role Student.
- Evidence: Screenshot of the home page

## AUTH-02: Sign in

- Role: Visitor | Risk: High | Device: Desktop
- Before you start: Existing test account
- Steps: 1. Open Sign in. 2. Enter the right email and a wrong password.
- Expected: A clear error appears. It does not say whether the email exists. No page change.
- Evidence: Screenshot of the error

## AUTH-03: Password reset

- Role: Visitor | Risk: High | Device: Desktop
- Before you start: Test account whose mailbox you can read
- Steps: 1. Choose Forgot password. 2. Enter the email. 3. Open the email. 4. Follow the link and set a new password. 5. Sign in with it.
- Expected: The email comes from the QuizBox sender (not the platform default), the link works once, the new password works, the old one does not.
- Evidence: Screenshot of the email header (sender) and the success page

## AUTH-04: Sign out

- Role: Student | Risk: High | Device: Desktop
- Before you start: Signed in
- Steps: 1. Sign out. 2. Press the browser Back button several times.
- Expected: No private page content is shown; you are asked to sign in.
- Evidence: Screenshot after Back

## STU-01: Navigation

- Role: Student | Risk: Medium | Device: Desktop
- Before you start: Signed in as a student
- Steps: 1. Look at the sidebar.
- Expected: Home, Practise, Assignments, Compete, Challenges, My challenges, Create and share, Progress, Assessments, Marketplace, Notifications, Unfinished work, Account are present and each opens a page.
- Evidence: Screenshot of the sidebar

## STU-02: Challenges link (regression QB-AUD-001)

- Role: Student | Risk: High | Device: Desktop
- Before you start: Signed in as a student
- Steps: 1. Click Challenges in the sidebar.
- Expected: The in-app list of open challenges and competitions opens inside the app. You are not asked to sign in and you are not sent back to Home.
- Evidence: Screenshot of the page and the address bar

## STU-03: Practice session

- Role: Student | Risk: High | Device: Desktop and phone
- Before you start: Student with free sessions left
- Steps: 1. Open Practise. 2. Choose a subject and topic. 3. Start. 4. Answer every question. 5. Submit.
- Expected: Questions match the chosen topic and grade; the score and explanations show; the result appears under Progress.
- Evidence: Screenshots of a question, the result and Progress

## STU-04: Free allowance

- Role: Student | Risk: High | Device: Desktop
- Before you start: Student who has used all free sessions
- Steps: 1. Try to start another practice session.
- Expected: A clear message explains a plan is needed and links to Subscribe. No session is created.
- Evidence: Screenshot of the message

## STU-05: Subscribe page

- Role: Student | Risk: High | Device: Desktop and phone
- Before you start: Signed in; adult student account
- Steps: 1. Open Prices or Subscribe.
- Expected: Cards are styled, show Coin and cedi prices, and the Weekly card says per week. Each payable card has a pay button.
- Evidence: Screenshot of the page

## STU-06: Student-created competition limits

- Role: Student | Risk: High | Device: Desktop
- Before you start: Signed in as a student
- Steps: 1. Open Create and share. 2. Start a competition.
- Expected: Only curriculum questions can be chosen; there is no prize, logo or reading-material option; the quiz is link-only, never listed publicly.
- Evidence: Screenshots of each step

## STU-07: Unfinished work

- Role: Student | Risk: Medium | Device: Desktop
- Before you start: Signed in
- Steps: 1. Start a competition and fill the first step. 2. Leave the page. 3. Open Unfinished work.
- Expected: Your draft is listed with the time left; opening it restores what you typed.
- Evidence: Screenshots before and after

## TCH-01: Class and young learner

- Role: Teacher | Risk: High | Device: Desktop
- Before you start: Signed in as a teacher
- Steps: 1. Create a class. 2. Add a young learner by first name.
- Expected: A username and password are shown once. The learner appears in the class. Reload: the password is not shown again.
- Evidence: Screenshot (hide the password before saving)

## TCH-02: Assignment

- Role: Teacher | Risk: High | Device: Desktop
- Before you start: Class with a learner
- Steps: 1. Create an assignment from the question bank. 2. Assign it to the class.
- Expected: The learner sees it under Assignments; it has the right title, questions and due date.
- Evidence: Screenshots from both accounts

## TCH-03: Gradebook

- Role: Teacher | Risk: High | Device: Desktop
- Before you start: Learner has submitted
- Steps: 1. Learner submits. 2. Open Gradebook.
- Expected: The score matches what the learner saw; no other class's learners appear.
- Evidence: Screenshot of the gradebook

## TCH-04: Teacher-created challenge

- Role: Teacher | Risk: Medium | Device: Desktop
- Before you start: Signed in as a teacher
- Steps: 1. Create a challenge with typed questions. 2. Make it public. 3. Copy the share link.
- Expected: The challenge appears in the open list; the link opens its page.
- Evidence: Screenshots

## CHL-01: Join and leaderboard

- Role: Student | Risk: High | Device: Desktop and phone
- Before you start: A public challenge exists; second student account
- Steps: 1. Open the challenge from Challenges. 2. Play it. 3. Check the leaderboard.
- Expected: Your score and time appear once; attempts stop at the limit.
- Evidence: Screenshot of the leaderboard

## CHL-02: Competition rounds

- Role: Student | Risk: High | Device: Desktop
- Before you start: A two-round competition
- Steps: 1. Finish round 1 above the pass mark. 2. Try round 2. 3. Repeat with a low score.
- Expected: Passing players reach round 2; others are told they did not go through.
- Evidence: Screenshots of both outcomes

## CHL-03: Reading material

- Role: Student | Risk: Medium | Device: Desktop
- Before you start: Competition with material
- Steps: 1. Join. 2. Open the reader before the round. 3. Start the timed round and try the reader again.
- Expected: Reading works before and is closed during the round and after it ends.
- Evidence: Screenshots

## CHL-04: Private quiz code

- Role: Student | Risk: High | Device: Desktop
- Before you start: A private quiz with an access code
- Steps: 1. Open the link. 2. Enter a wrong code. 3. Enter the right code.
- Expected: Wrong code is refused with no hint; right code lets you join.
- Evidence: Screenshots

## SPN-01: Sponsor branded quiz

- Role: Sponsor | Risk: Medium | Device: Desktop
- Before you start: Signed in as a sponsor
- Steps: 1. Create a quiz with a logo, colour and reading material. 2. Publish.
- Expected: The card shows the logo and organiser; it can appear in the sponsored carousel for the audience chosen.
- Evidence: Screenshot of the card and carousel

## ADM-01: Admin prices

- Role: Admin | Risk: High | Device: Desktop
- Before you start: Preview admin account
- Steps: 1. Open Prices. 2. Change a plan's Coins. 3. Wait one minute. 4. Open the public Pricing page.
- Expected: The public page shows the new price. A price that is not Coins x unit is refused.
- Evidence: Screenshots of Admin and public page

## ADM-02: Question loading dry run

- Role: Admin | Risk: High | Device: Desktop
- Before you start: A small test CSV
- Steps: 1. Open Load Questions. 2. Upload the CSV as a dry run.
- Expected: Errors list the row and the reason; nothing becomes active.
- Evidence: Screenshot of the report

## ADM-03: Batch approval

- Role: Admin | Risk: High | Device: Desktop
- Before you start: A loaded test batch
- Steps: 1. Approve the batch. 2. Search a question from it in Practise.
- Expected: The questions appear only after approval; re-approving does nothing new.
- Evidence: Screenshots

## PAY-01: Test-mode payment

- Role: Student | Risk: High | Device: Desktop and phone
- Before you start: Paystack TEST keys on Preview; adult student
- Steps: 1. Choose a GHS 5 plan. 2. Pay with a Paystack test card or mobile-money test number. 3. Return to the site. 4. Refresh twice.
- Expected: Coins and access are granted once. Refreshing or replaying does not grant again.
- Evidence: Screenshots of the receipt and wallet

## PAY-02: Minimum charge

- Role: Student | Risk: Medium | Device: Desktop
- Before you start: Adult student
- Steps: 1. Try to buy less than 5 Coins if the screen allows it.
- Expected: The message says the smallest online payment is GHS 5.
- Evidence: Screenshot

## PAY-03: Child cannot pay

- Role: Young learner | Risk: High | Device: Desktop
- Before you start: Teacher-managed child account
- Steps: 1. Open Subscribe.
- Expected: No pay button; the page says to ask a teacher or parent.
- Evidence: Screenshot

## SEC-01: Other learner's results

- Role: Student A and B | Risk: High | Device: Desktop
- Before you start: Two students with results
- Steps: 1. As A copy the URL of a result. 2. Sign in as B and open it.
- Expected: B cannot see A's result.
- Evidence: Screenshot of the refusal

## SEC-02: Role boundaries

- Role: Student | Risk: High | Device: Desktop
- Before you start: Signed in as a student
- Steps: 1. Type an admin or teacher address in the browser.
- Expected: You are sent back to your own home. No admin data flashes on screen.
- Evidence: Screenshot

## SEC-03: Other teacher's class

- Role: Teacher A and B | Risk: High | Device: Desktop
- Before you start: Two teachers with classes
- Steps: 1. As B, try to open A's class by its address.
- Expected: Refused or empty; A's learners are not shown.
- Evidence: Screenshot

## SEC-04: Signed out access

- Role: Visitor | Risk: High | Device: Desktop
- Before you start: Not signed in
- Steps: 1. Open the student home address directly.
- Expected: You are sent to Sign in.
- Evidence: Screenshot

## UX-01: Phone layout

- Role: Any | Risk: Medium | Device: Phone 390 px
- Before you start: Any account
- Steps: 1. Open Home, Pricing, Practise, a challenge on a phone or a narrow window.
- Expected: No sideways scrolling, text readable, buttons reachable.
- Evidence: Screenshots

## UX-02: Keyboard only

- Role: Visitor | Risk: Medium | Device: Desktop
- Before you start: -
- Steps: 1. Press Tab from the top of Home. 2. Press Enter on Skip to content.
- Expected: A Skip to content link appears first and moves you to the main content; focus is always visible.
- Evidence: Screenshot with focus visible

## UX-03: Header when signed in

- Role: Student | Risk: Medium | Device: Desktop
- Before you start: Signed in
- Steps: 1. Open the public Pricing page.
- Expected: The header shows Open my workspace instead of Sign in and Get started; it opens your home page.
- Evidence: Screenshot

## DATA-01: Question display

- Role: Student | Risk: High | Device: Desktop
- Before you start: Practice session
- Steps: 1. Review five questions in different subjects.
- Expected: Four options, a single right answer, an explanation after answering, maths shows properly.
- Evidence: Screenshots of any problem

## DATA-02: Garbled characters

- Role: Any | Risk: Low | Device: Desktop
- Before you start: Practice or challenge with French
- Steps: 1. Look for a question reading 'In the written phrase ? demain'.
- Expected: Report it if you find it (known defect QB-AUD-010).
- Evidence: Screenshot

