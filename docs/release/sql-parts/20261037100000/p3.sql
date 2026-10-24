insert into public.policy_versions(document_id, version_no, summary, body)
select d.id, 1, 'Initial version', $body$# Refund Policy

This policy explains what happens if you are charged twice, or a payment does not reach your account. It belongs with our [Terms of Use](/terms).

## How your payment works

QuizBox is run by {{company_name}}, {{country}}. Payments are made in Ghana cedis (GHS) through Paystack, by mobile money or card. One Coin is worth GHS 1. Your payment becomes Coins on your account, and the Coins are used for the plan or quiz seats you chose. Paystack sends you a receipt.

## The 7-day window

Ask for help within **7 days** of the payment. After 7 days we cannot reverse a payment.

## If you were charged more than once

If the same purchase was charged more than one time, we add the extra amount to your account as **Coins**. The extra is not paid back in cash. For example, if you paid GHS 10 twice for one plan, the second GHS 10 is added to your account as 10 Coins.

To check a duplicate we need evidence that the extra charge was not applied to your account: the Paystack receipt or reference for each charge, and a screenshot or statement from your mobile-money or bank account showing both charges.

## If you paid but nothing was added to your account

First we apply the payment to your account. If we cannot apply it, we refund it in cash to the way you paid, but **only if none of the Coins from that purchase have been used**. We check this in your account activity log. Coins that have already been used are not refunded.

## How to ask

1. Open the [contact page](/contact) and choose **Payment or refund** as the enquiry type.
2. Give the email on your QuizBox account, the Paystack reference, the date and the amount, and what went wrong.
3. For a duplicate charge, include the evidence described above. If you need to send a screenshot or statement, we will tell you how when we reply.

We decide within **3 working days** and tell you by email. If a cash refund is approved, it is sent through Paystack to the way you paid. How long it takes to reach you depends on your bank or mobile-money provider.

## Children's accounts

Children under 13 do not pay online. A parent, guardian or school arranges the subscription and can ask for help in the same way.

Questions? Write to {{support_email}}.

Issued by {{company_name}}, {{country}}.
$body$
from public.policy_documents d where d.slug = 'refunds' and not exists (select 1 from public.policy_versions v where v.document_id = d.id);
