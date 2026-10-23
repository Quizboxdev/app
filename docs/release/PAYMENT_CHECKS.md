# Payment checks (no database change)

**Admin, Payment checks** (finance admins and the owner) finds payments where someone paid on Paystack but did not get what they bought, and fixes them with one button. No database change is needed; it uses the existing payment records and asks Paystack directly.

What it finds (last 14 days by default; choose 3 to 60):
- **Paid, not recorded:** Paystack says success, our record still says "initiated" or "pending" (the webhook never arrived).
- **Paid, not delivered:** our record says paid and the Coins were credited, but the subscription or Marketplace set was never granted.
- **Still in progress:** Paystack says the payment is still being processed (a mobile-money prompt not yet approved). Nothing to do yet.
- **Not paid:** abandoned, failed, or never seen by Paystack. Nobody was charged. Hidden unless you tick the box.

**Settle now** records the payment and grants the purchase exactly the way the webhook would. Only Paystack's own answer is trusted, it is safe to press twice (it cannot credit or grant twice), and every manual settle is written to the audit log (`payment.settle_manual`). Payments started in the last 3 minutes are not checked, so a buyer who is still paying is left alone.

The three layers that now protect a payment: (1) the Paystack webhook, (2) the page the buyer returns to asks Paystack directly, (3) this screen for anything that still slipped through.

Try it: open Admin, Payment checks. With everything settled it says "All clear". To see a flag, start a Marketplace purchase, approve the mobile-money prompt after the page times out, and press Check now.
