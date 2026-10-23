# Walkthrough of the new features (about 60 minutes)

For one tester with four accounts: **owner**, **finance admin** (an admin with the finance capability), **teacher** and **student** (plus a second student for buying). Use Preview with Paystack test keys if you can; on live, buying costs a real GHS 5.
Tick each line. Anything that does not behave as written: note the page, what you did, what you saw, and send it to me with a screenshot.

## 1. Policies and the acknowledgement (owner, then a new student)
- [ ] Admin, Policies: the four policies show as published with your company details filled in (no `{{ }}` left in the text).
- [ ] Sign up a brand-new student: after sign-up a prompt asks to accept the Terms and Privacy Notice; the app cannot be used until accepted.
- [ ] Open /terms, /privacy, /refunds, /cookies signed out: all read well on a phone.
- [ ] Admin, Export data, Policy acceptances: the new student's two acceptances appear.

## 2. Support requests (student, then owner)
- [ ] Student: Support, send a request with a PNG attached. It gets a reference and appears in "My requests".
- [ ] Owner: Admin, Support requests: open it, reply, set it resolved. The student sees the reply.
- [ ] Signed out: /contact form with an attachment sends and gives a reference.

## 3. Help centre (any account)
- [ ] Help in the top bar opens the guides for your role (a student sees learner guides first; no admin workflows anywhere).
- [ ] Search for "class code": the right guide appears. Open it: steps are clear; "Was this helpful" works once.
- [ ] A guide's "send us a request" link opens a support request with the guide named.

## 4. Seat bundles (teacher; only after you switch seat limits on in Admin, Access)
- [ ] Teacher creates a new challenge with three questions and publishes it: People tab says "0 of 5 places used".
- [ ] Five students join; the sixth sees "This quiz is full".
- [ ] Teacher chooses 10 players: if short of Coins, the page offers exactly the missing Coins, pays, returns to the People tab, then "Use 10 Coins" adds the places; the sixth student can now join.

## 5. Marketplace (teacher, owner, two students)
- [ ] Teacher: Sell question sets, apply. Owner: Admin, Marketplace, Sellers: verify.
- [ ] Teacher: add a set with 10+ questions, price GHS 5, send for review. A set with 9 questions, or a price of 4 or 5.50, is refused with a clear message.
- [ ] Owner: Sets to review: open, check the questions show, approve. Open the Marketplace switch (Merchant account tab).
- [ ] Student A: Marketplace shows the set with "Subject · School"; buy it; return to My question sets within seconds; practise it; score is shown.
- [ ] Student A cannot buy it again while owned; the teacher cannot buy their own set; a managed child cannot pay.
- [ ] Teacher: Sell question sets shows 1 sale, GHS 5 paid, GHS 3 yours, held 7 days. Get paid says nothing available yet.
- [ ] Owner, Payment checks: "All clear".
- [ ] (Optional) Move the sale past the hold with the SQL in APPLY_MARKETPLACE.md, make enough sales for GHS 20, request a payout: the page shows sales, less QuizBox 40%, equals what you receive; approve; Admin, Marketplace, Payouts shows the account; mark it paid with a reference; the teacher sees "Paid".
- [ ] Refund one sale on the Paystack dashboard: within a minute the buyer loses the set and the teacher's share for it is taken back.

## 6. Exports (owner, finance admin)
- [ ] Owner: Admin, Export data: pick Payments, Last 30 days: preview and count show; Excel opens with real dates, a filter row and an About sheet; CSV opens in Excel with correct dates.
- [ ] Try one dataset from each group (Money, Marketplace, Reviewers, Support and help, Challenges, Content, Schools, People and audit).
- [ ] Finance admin sees the money datasets but not Accounts, Learners, Teachers, Policy acceptances or Audit log.
- [ ] Audit log export lists your own downloads as `export.run`.

## 7. Payment checks (finance admin or owner)
- [ ] Admin, Payment checks: Check now returns "All clear" or a short list; "Not paid" rows are hidden until you tick the box.
- [ ] Start a Marketplace purchase, close the Paystack page without paying: after 3 minutes it shows as "Not paid" and never as an issue.

## 8. Server-side guard (only when QB_SERVER_GUARD is on in Preview; see SERVER_GUARD.md)
- [ ] Signed out, /admin, /student, /seller, /marketplace go straight to login; /pricing, /help, /challenges, /terms open.
- [ ] Signed out, /play/<quiz-slug> goes to login and returns to the quiz after sign-in.
- [ ] Signed in as each role, every page you normally use opens and navigation feels the same.

## 9. Everyday smoke check (all roles)
- [ ] Each role signs in, lands on the right home page, the menu shows only what that role should see, and sign-out works.
- [ ] The site is usable at phone width: pricing, Marketplace, Help, a quiz.
