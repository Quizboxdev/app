-- Three Help guides for the Marketplace, saved as DRAFTS because the Marketplace is switched on by the owner (Admin, Marketplace, Merchant account).
-- Publish them in Admin, Help guides when you open the Marketplace. Each is inserted only if it is not there yet.
-- Rollback: delete the guides in Admin, Help guides.
begin;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, body) values ('sell-question-sets', 'Sell your end-of-term questions', 'How verified teachers post question sets with their school''s name, set a price, and earn 60% of every sale.', 'payments', array['teacher'], 130, 'draft', $body$# Sell your end-of-term questions

Teachers can sell their end-of-term question sets on the QuizBox Marketplace. Every set shows where it comes from, for example **Chemistry · Opoku Ware School**, so buyers know what they are getting.

## Become a seller

1. Open **Sell question sets** in the menu.
2. Enter your name as buyers will see it, your school, your phone number, and where you want to be paid (mobile money or bank).
3. Read the seller terms, tick the box, and press **Apply to sell**.
4. QuizBox checks your details and tells you when your account is **verified**. You can prepare sets while you wait.

## Add a question set

1. Press **Add a question set**.
2. Give it a title, the subject, the school the questions come from, the class and the term.
3. Set a price in **whole cedis from GHS 5 to GHS 200**. You will see what you earn.
4. Paste your questions. Put a blank line between questions, give each 2 to 5 answers (A, B, C…) and a line like `Answer: B`. A `Why:` line is optional. A set needs **at least 10 questions**.
5. Press **Save and send for review**.

QuizBox reviews every set before it goes on sale. If something needs changing, you will see the reason and can fix it and send it again. Please use only questions you wrote or have the right to sell.

## How the money works

- Every sale is shared **60% to you and 40% to QuizBox**. QuizBox pays the payment fees from its 40%.
- Buyers keep a set for **90 days**.
- Your share becomes available to request **7 days after a sale**. This is the refund window.
- On the **Sell question sets** page you see every set with how many times it sold, the amount buyers paid, and your 60%.
- If a sale is refunded, your share for that sale is taken back.

## Get paid

1. When money is available, press **Approve and request**. You are shown the sales, QuizBox's 40% taken off, and the exact amount you will receive. Check it before you approve.
2. QuizBox pays you by hand within **24 hours on working days** (Monday to Friday) and sends you a notification with the reference.
3. You can cancel a request before it is paid.

Questions about a payout? [Send us a request](help:contact-support).
$body$) on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, body) values ('buy-a-question-set', 'Buy and practise a question set', 'Find end-of-term question sets from teachers, buy one, and practise it for 90 days.', 'payments', array['student', 'teacher', 'everyone'], 131, 'draft', $body$# Buy and practise a question set

The Marketplace has end-of-term question sets written by verified teachers. Each shows its source, for example **English · VPCS**.

## Buy a set

1. Open **Marketplace** in the menu.
2. Search or filter by subject, class or school.
3. Open a set to see its description and a few sample questions.
4. Press **Buy**. You pay by mobile money or card on the secure Paystack page.
5. You come back to **My question sets**, where the set appears in a few seconds.

Children with a teacher-managed account cannot pay. Ask your teacher or a parent to buy the set for you.

## Practise

1. Open **My question sets** and press **Practise this set**.
2. Answer each question. You see the right answer and the explanation straight away.
3. At the end you see your score. You can practise again as often as you like.

## How long you keep it

A set stays in your account for **90 days** from the day you buy it. **My question sets** shows how many days are left. After 90 days you can buy it again.

## Refunds

See [how to ask for a refund](help:ask-for-a-refund). If a purchase is refunded, the set is removed from your account.
$body$) on conflict (slug) do nothing;

commit;
