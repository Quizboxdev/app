# 12. Commercial operations manual

Date: 2026-10-25. For the owner, finance and support staff. It describes the routine that keeps the money side of QuizBox correct. Only what exists today is described; later releases add sections. All amounts are Ghana cedis (GHS) unless stated; the database stores pesewas (GHS 1 = 100).

## 1. Who does what

| Task | Who | Where |
|---|---|---|
| Decide commission policy, switch the programme on or off | Owner / super admin | Admin → Affiliates |
| Draft a policy change | Finance admin or owner | Admin → Affiliates → Policy |
| Approve a policy | A different person (owner may approve their own, recorded) | same |
| Approve or pause an affiliate | Owner, super admin, finance admin | Applications tab |
| Check payments against Paystack | Finance | Admin → Payment checks |
| Reverse a commission by hand | Finance with a written reason | Commissions tab |
| Approve and pay a marketplace payout | Finance | Admin → Payouts / Marketplace Governance |

## 2. Daily (5 minutes)

1. Admin → Payment checks: "All clear". Anything flagged is a payment Paystack took that QuizBox did not record; settle it with the tool (idempotent).
2. Admin → Affiliates → Applications: new applicants waiting. Aim to answer within 2 working days.
3. Support requests mentioning a payment or a referral link: answer from the payment reference.

## 3. Approving an affiliate

1. Confirm the person is an adult with a valid ID (outside the system: look at the ID, note that you did).
2. Confirm the payout details exist and match their name.
3. Tick the identity box and approve. If anything is doubtful, reject with a reason; they may re-apply.
4. Never approve a child, a school-managed learner, or someone who asked for a fee to join.

## 4. Monthly commission routine (until payouts are built, this is by hand)

1. First working day: open Commissions. Note **Approved** (available) per affiliate; those are due.
2. Check each affiliate's approved amount is at least the policy minimum (GHS 50 under the pilot).
3. A negative available balance means refunds after approval: do not pay that affiliate until later earnings offset it.
4. Pay by mobile money or bank transfer to the saved details; keep the transfer reference.
5. Record the payment outside the system for now (the payout release adds a recorded step and a second approver). Until then keep a monthly sheet: affiliate, amount, reference, date, who paid, who checked.
6. Record the month's totals in the finance file: gross receipts, tax, provider fees, commissions accrued, commissions reversed, commissions paid.

## 5. Reconciliation (monthly, 30 minutes)

The ledger must tie out. On the Commissions tab:

- **Held + Approved + In a payout + Paid = Total of all ledger rows.** If not, stop and contact engineering; do not pay.
- Every commission shows its payment reference. Spot-check three against Paystack: amount, date, status.
- Sum of commissions accrued ≤ cap % of the net revenue of the same payments (the table shows "cap held back" where the cap applied).
- Compare the affiliate share of revenue with the budget agreed for acquisition.

## 6. Refunds and chargebacks

- A refund processed by Paystack reverses the subscription and the commission automatically.
- A refund made another way (cash, bank): Commissions → Reverse a commission with the reference and the reason.
- Reversal never deletes a row. If the commission had already been paid, the affiliate's available balance becomes negative and is offset by future earnings; if they leave, recovery follows the affiliate terms (counsel).

## 7. Suspected fraud

Signs: many referrals from one device or network, referred customers who never use the product, refunds clustering on one affiliate, payment details shared between affiliates. Action: Pause the affiliate (a reason is required), reverse the suspicious commissions, keep the evidence, tell the owner. A paused affiliate keeps their balances.

## 8. What the system will not let you do (by design)

Edit a ledger row; change an approved policy; pay a commission on a renewal; pay for recruiting an affiliate; accrue on an unpaid or unfulfilled subscription; approve your own policy draft if you are finance (not owner); show a customer's identity to an affiliate.

## 9. Escalation

Ledger does not tie out, a payment is recorded twice, Paystack webhook failures, or a legal letter: owner first, then engineering with the payment reference. Do not attempt database fixes by hand.
