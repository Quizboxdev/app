# 11. Product user guides and intern beta-testing scripts

Date: 2026-10-25. This file covers the flows that exist in the application now. Guides for flows that are not built yet are listed at the end as NOT AVAILABLE rather than described. **Screenshots: none are included.** The signed-in screens could not be opened in a browser in this environment (no working test accounts on a Preview deployment, and passwords may not be typed by the assistant on production), so every flow below is marked **BLOCKED for screenshots**. Interns capture them while testing (see §5).

Existing learner, teacher and marketplace guides: `docs/ux-audit/11_BETA_TESTER_USER_GUIDES.md` and the in-app Help centre (`/help`). This file adds the affiliate programme and the finance steps; update those guides rather than duplicating them.

## 1. Affiliate guide (the person who refers)

**Before you start.** The programme must be switched on (the page says "not open yet" otherwise). You must be an adult with an ordinary QuizBox account. Children and school-managed learners cannot join.

1. Sign in and open **/affiliate** (your invitation link from QuizBox).
2. Fill in your name and phone number. Tick that you are 18 or older and that you accept the terms (draft terms are shown on the screen). Press **Apply**.
3. Open **Where we pay you**. Choose mobile money or bank, the network or bank, the account number (digits only) and the name on the account. Press **Save payout details**. Only the last 4 digits are ever shown again.
4. Wait for approval. The page shows **Waiting for review**. QuizBox checks your identity and details, then you see **Approved** and your link.
5. Copy your link (it looks like `https://www.quizbox.io/r/AB12CD34`) and share it with parents or schools.
6. When someone opens your link and signs up, they are yours for 30 days. When they pay for their **first subscription**, a commission appears under **Recent commissions** as **Held**. After the checking period it becomes **Approved**.
7. If the payment is refunded, the commission shows **Reversed (refund)** and is taken back.

What you will not see: who your customers are. You see counts, amounts and dates only.

What does not earn a commission: your own purchases, renewals, buying Coins, people who had already paid QuizBox before using your link, and recruiting other affiliates.

## 2. Finance and administration guide

Open **Admin → Affiliates** (owner, super admin or finance admin).

**Programme card (top).** Shows ON or OFF. Only the owner or a super admin can switch it. Switching on needs an approved policy and a ticked confirmation.

**Applications tab.**
1. Choose **Waiting for review**.
2. For each applicant check: payout details present, and (outside the system) their identity document and age.
3. Tick "I checked this person's identity… 18 or older", then **Approve**. To refuse, write a reason and press **Not approved**.
4. Later you can **Pause**, **Restore** or **End** an affiliate; each needs a reason.

**Policy tab.**
1. Read the version in force and the pilot draft.
2. To change anything, open **Save a new draft version**, enter the numbers, **Save draft**.
3. A different person presses **Approve and make this the policy in force**. The owner may approve their own; this is recorded.
4. Old versions stay; every commission shows which version it used.

**Commissions tab.**
- The ledger line shows Held, Approved, In a payout and Paid, and a total that must equal the sum of the four.
- The table lists every commission with gross, tax, net, rate and status. "cap held back" means the 15 % combined cap reduced the commission.
- **Reverse a commission** is for a refund made outside Paystack: enter the payment reference (starts with QB-) and a reason.

## 3. Intern test script: affiliate programme (run on Preview only)

Prerequisites: Preview database has migration `20261048100000`; the tester has three accounts (an adult affiliate, a customer, a finance/owner account); Paystack **test** keys are set.

| # | Step | Expected | Result |
|---|---|---|---|
| A1 | As the owner open Admin → Affiliates | Programme OFF; a draft pilot policy; no commissions | |
| A2 | As the affiliate open /affiliate | "not open yet" | |
| A3 | Owner: Policy → approve the pilot draft; then switch the programme ON | Policy "In force"; programme ON | |
| A4 | Affiliate: Apply (leave the 18+ box empty) | Apply button disabled | |
| A5 | Affiliate: tick both boxes, Apply, save payout details | "Waiting for review" | |
| A6 | Owner: Applications → Approve without ticking the identity box | Button refused with a clear message | |
| A7 | Owner: tick the box, Approve | Affiliate shows Approved with a link | |
| A8 | Customer (new account, signed out): open the affiliate's link, then sign up | Lands on the home page, then in the app | |
| A9 | Customer: pay for a monthly plan with a Paystack **test** card | Subscription active | |
| A10 | Affiliate: open /affiliate | One commission, **Held**, rate 10 %, amount = 10 % of the price | |
| A11 | Customer pays for a second plan | No second commission | |
| A12 | Affiliate opens their own link while signed in and pays | No commission | |
| A13 | Refund the payment in Paystack test mode | Commission becomes **Reversed**; held balance falls back | |
| A14 | Owner: Commissions tab | Ledger total equals the four buckets added up | |
| A15 | Try to open /admin/affiliates as the plain customer | Redirected away | |

Record PASS / FAIL / BLOCKED for each row in `09_QA_AND_TEST_REPORT.md` with the date and what was seen. Do not use production data or real payment cards.

## 4. Other flows (existing)

Student registration and assessments, teacher classrooms, marketplace publishing and buying, competitions and challenges, admin exports: see `docs/ux-audit/11_BETA_TESTER_USER_GUIDES.md` and `/help`.

## 5. Capturing screenshots

While running §3, take a screenshot after each row that has a visible result. Save into `docs/quizbox-transformation/evidence/` named `A10-held-commission.png` (row id and what it shows). Never capture pages that show a real person's name, phone number or account number; use test data. Any row not captured stays **BLOCKED for screenshots**.

## 6. Not available yet (no guide, by design)

Guardian parent screens; school subscription and onboarding; alumni and legacy sponsorship; regional manager CRM; affiliate payouts and dashboard tiers beyond the summary; subscriber referral Coins; competition templates, appeals and certificates. Their guides are written when the flows ship so that no guide describes a button that does not exist.
