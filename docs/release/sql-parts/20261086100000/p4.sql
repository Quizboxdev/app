insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body)
values ('pay-for-children', 'Buy Coins and subscriptions for your children', 'Pay once for the children you choose, with a plan or Coins for each one.', 'payments', array['teacher','sponsor']::text[], 65, 'draft', null, $g$
# Buy Coins and subscriptions for your children

You can buy Coins and subscriptions for one child, several children, or everyone in your family. Each child gets their own Coins or plan, and you pay once.

## Buy Coins

1. Open **Family workspace**, then **Coins and wallet**.
2. The balances show each child's Coins and plan.
3. Tick the children you are buying for. For each one, choose how many Coins. Press **Same amount for everyone** to set them all at once, then change any child you want to.
4. Check the summary, which shows each child's amount and the total.
5. Press **Pay**. You will go to the payment page.

## Buy a subscription

1. Open **Family workspace**, then **Subscriptions**.
2. Tick the children and choose a plan for each one. Children can be on different plans. **Same plan for everyone** is a shortcut.
3. Check the summary and press **Pay**.

## After you pay

- Your children's Coins or subscriptions are added once the payment is confirmed. The page **Payment received** shows what each child received.
- If the page says the payment is still being confirmed, wait a few minutes and check **Coins and wallet** or **Subscriptions** again. Nothing is lost.
- If a refund is made, the Coins and subscriptions are taken back.

## Good to know

- The smallest amount for one child is 5 Coins.
- Children under 13 cannot pay online. You arrange their Coins and subscriptions from your family workspace.
- Each child's subscription can be changed or stopped on its own.
$g$)
on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body)
values ('family-question-library', 'Give a question set to your children', 'Give a Marketplace question set you bought to the children you choose.', 'practise', array['teacher','sponsor']::text[], 66, 'draft', null, $g$
# Give a question set to your children

A question set you buy in the **Marketplace** can be given to children in your family. Nothing is copied: each child practises the original set for as long as your purchase lasts.

## Steps

1. Buy a set in the [Marketplace](help:buy-a-question-set).
2. Open **Family workspace**, then **Question library**.
3. Find the set. Press **Give to children**.
4. Tick the children it is for, then press **Give**.

Each child is told, and sees the set under **Question sets from your family** on their home page.

## Good to know

- You can take a set back from any child. Press the **×** next to their name.
- If your purchase runs out, or is refunded, the children lose access to the set at the same time.
- The page shows each child's best score on the set.
$g$)
on conflict (slug) do nothing;

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, published_at, body)
values ('family-challenges', 'Invite your children to a challenge', 'Invite the children you choose to a challenge you made, with its access code.', 'challenges', array['teacher','sponsor']::text[], 67, 'draft', null, $g$
# Invite your children to a challenge

Make your challenge the way you normally do, in **Create and share**. Then invite the children in your family to take part.

## Steps

1. Create and publish your challenge. See [how to create a challenge](help:create-a-challenge).
2. Open **Family workspace**, then **Challenges**.
3. Find your challenge and press **Invite children**.
4. Tick the children, then press **Invite**.

Each child sees the challenge under **Challenges from your family** on their home page. If the challenge is private, the access code is shown there too. They press **Play** and take part as usual.

## Good to know

- You can take an invitation back at any time, with the **×** next to the child's name.
- Children who are under 13 follow the same challenge rules as everyone else.
- Your challenge's results are on its page in **Create and share**.
$g$)
on conflict (slug) do nothing;
