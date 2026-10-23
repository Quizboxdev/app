# Refund policy: decisions and open points

Source of truth for `/refunds` (`app/(public)/refunds/page.tsx`). Decisions by the owner, 2026-10-23.

| Topic | Decision |
|---|---|
| Window | 7 days from the payment |
| Duplicate charge | Extra amount is credited to the account as Coins (1 Coin = GHS 1), not paid back in cash. The buyer submits evidence that the extra charge was not applied to their account |
| Payment received but not applied ("unassigned") | We apply it. If we cannot, a cash refund goes to the original payment method, only if none of the Coins from that purchase were used (checked in the account activity log) |
| Used Coins | Not refunded |
| How to ask | Contact form, enquiry type "Payment or refund" |
| Answer time | Decided within 3 working days, by email |
| Children under 13 | Do not pay online; a parent, guardian or school arranges it |

## Points to confirm
1. **Change of mind on an unused purchase** (a normal payment that was applied but never used) is not covered by the decisions above, so the page says nothing about it. Decide whether it is refundable inside 7 days.
2. **Evidence upload.** The contact form has no file upload, so the page tells buyers to describe the charges and says we will explain how to send a screenshot. A dedicated refund form with upload is a separate build.
3. **Crediting the extra as Coins** is built: Admin, Operations, Refunds (migration 20261035100000, `docs/release/APPLY_REFUNDS.md`).
4. **Terms and Privacy** are still placeholders marked "legal content required". A lawyer should review this page together with them.

## Operating the process (for the owner)
1. A request arrives through the contact form. Find the payment in Admin, Online payments, by reference.
2. Duplicate: confirm both charges in the Paystack dashboard, credit the extra Coins (Admin, Refunds), reply by email.
3. Unapplied: apply the payment. If that is impossible and no Coins were used, refund from the Paystack dashboard. The site ends any granted plan automatically when Paystack reports the refund.
4. Reply within 3 working days.
