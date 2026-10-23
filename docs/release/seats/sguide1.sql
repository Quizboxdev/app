-- One more Help guide, for seat bundles: how an organiser adds places to a challenge or competition. It is saved as a DRAFT because it describes a feature that is switched on by the owner
-- (Admin, Access and Subscriptions, Seat limits). Publish it in Admin, Help guides when you switch seat limits on. Inserted only if the guide is not there yet.
-- Rollback: delete the guide in Admin, Help guides.

insert into public.help_articles(slug, title, summary, category, audiences, sort_order, state, body) values ('add-more-players', 'Add more players to your quiz', 'A quiz is free for a few players. Here is how to add places for more, and what it costs.', 'challenges', array['student', 'teacher', 'sponsor'], 115, 'draft', $body$# Add more players to your quiz

A new challenge or competition is free for its first 5 players. To host more people, you add places. A place costs **1 Coin**, and 1 Coin is worth GHS 1.

## Add places

1. Open your quiz from **Create and share** (learners) or **Challenges** (teachers and sponsors).
2. Open the **People** tab. It shows how many places are used, for example "3 of 5".
3. Choose a bundle: **10, 20, 50, 100, 200, 500 or 1000 players**, or type your own number up to 1000.
4. You will see the price, for example "50 players = 50 Coins = GHS 50".
5. Press **Use 50 Coins for 50 players**. The places are added at once.

## If you do not have enough Coins

The page tells you how many more you need. Because the smallest online payment is 5 Coins, you may be asked to pay for a little more than you need. Press the pay button, pay with mobile money or card, and you come straight back to the **People** tab. Then press the button to use your Coins. See [subscribe, Coins and paying](help:subscribe-and-coins).

## Good to know

- **Upgrading later:** you pay only for the extra places. If you paid for 50 and now need 100, you pay for 50 more.
- **When the quiz is full:** new people are told "This quiz is full". People who are already in keep their place until the quiz ends.
- **Classes and schools:** a quiz for one class or one school has no limit and costs nothing.
- **Players do not use their free sessions** when they join a quiz that you paid places for.
- **You get full access to QuizBox** while your quiz runs, for up to 90 days.
- A mistake? See [how to ask for a refund](help:ask-for-a-refund). Questions? [Send us a request](help:contact-support).

Then [share your quiz](help:share-challenge-or-competition).
$body$) on conflict (slug) do nothing;


