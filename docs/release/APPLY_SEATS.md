# Turning on seat bundles for challenges and competitions (migrations 20261041100000 and 20261042100000)

What it does: a new challenge or competition is **free for its first 5 players**. To host more, the organiser adds places on the quiz's new **People** tab: **1 Coin per player** (1 Coin = GHS 1), in bundles of 10, 20, 50, 100, 200, 500 or 1000, or their own number up to 1000, paid from their Coins. If they do not have enough Coins, they pay for exactly what is missing (smallest online payment 5 Coins) by mobile money or card and come back to finish. They can upgrade later and pay only the difference.
- When a quiz is full, new people see "This quiz is full" (on the quiz page and when they try to join); people already in keep their place.
- Players of a quiz whose organiser paid places do **not** use their own free sessions.
- A quiz for one class or one school has no limit and costs nothing.
- The organiser gets full access to QuizBox while the quiz runs (at most 90 days), as the bundle cards on the pricing page say.
- **Nothing changes until you switch it on.** The database change adds the feature switched OFF. When you switch it on, only quizzes created afterwards have the 5-player limit; quizzes made before keep no limit.

## 1. Database (two parts, then the guide)
Supabase, project `fmgccmqxfjppqydkhaiu`, SQL editor. For each part: run the copy command in PowerShell, paste into a new query, Run, expect "Success". Safe to run twice. (These parts replace the quiz join, quiz start and free-session functions with the current versions plus the seat checks; nothing else in them changes.)

Part 1:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\seats\seats1.sql" -Raw | Set-Clipboard
```
Part 2:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\seats\seats2.sql" -Raw | Set-Clipboard
```
Verify (expect 4 rows, then 4 rows, then 2 rows, then one row with `true` in both columns):
```sql
select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('qb_challenge_full','qb_challenge_seat_status','qb_challenge_seats_buy','qb_challenge_seats_info') order by 1;
select column_name from information_schema.columns where table_schema='public' and table_name='challenge_campaigns' and column_name in ('seat_cap','seats_paid','seats_paid_at','seats_paid_by') order by 1;
select key, value from public.platform_settings where key in ('flags.paid_challenges','challenges.free_seats') order by 1;
select pg_get_functiondef('public.challenge_join(text,text)'::regprocedure) like '%QUIZ_FULL%' as join_checks_seats, pg_get_functiondef('public.challenge_start(text,text,integer)'::regprocedure) like '%QUIZ_FULL%' as start_checks_seats;
```
The settings should show `flags.paid_challenges` = `false` and `challenges.free_seats` = `5`.

The Help guide (saved as a draft, publish it when you switch seat limits on):
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\seats\sguide1.sql" -Raw | Set-Clipboard
```

## 2. Try it before switching it on (nothing is charged and nothing changes for anyone)
With seat limits OFF, make a challenge and open its **People** tab: it says limits are not switched on. Everything else works as before.

## 3. Switch it on, and test once
1. Admin, **Access and Subscriptions**, section **Seat limits for challenges and competitions**: press **Switch seat limits on** (it needs Online payments to be ON).
2. As a teacher test account, create a **new** challenge, add three questions, publish. Its People tab says "0 of 5 places used. The first 5 players are free."
3. Join it with five learner test accounts. The sixth sees **"This quiz is full. Please ask the organiser to add more places."**, and the public quiz page shows "This quiz is full".
4. Back on the teacher's People tab, choose 10 players. If the teacher has fewer than 10 Coins, the page offers "Pay GHS N for N Coins" (live: a real small payment; Preview: Paystack test mode), returns to the People tab, and then "Use 10 Coins for 10 players" adds the places. The sixth learner can now join.
5. Publish the Help guide "Add more players to your quiz" (Admin, Help guides).

## Rules built in
- The price is 1 Coin per player and is worked out in the database. The browser cannot change it. Repeating the same purchase never charges twice. A bundle can be raised but not lowered.
- Only the quiz's owner (or a challenge admin) can add places. The payer is the person pressing the button.
- Seats are bought with Coins already in the wallet. Buying Coins uses the normal checkout (`/api/payments/checkout` with a Coins amount, 5 to 1000, price computed on the server); they return to their quiz page afterwards.
- Coins spent on seats are used Coins: under the Refund Policy they are not refunded. A mistaken purchase is handled by you in Admin, Refunds.
- The three replaced functions keep their original permissions. Rollback: `supabase/rollback/challenge_seats.sql` restores them as they were and removes the seat functions; the seat columns and what organisers paid are kept.
