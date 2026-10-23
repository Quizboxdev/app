# The Marketplace (migrations 20261043100000 and 20261044100000)

What it does: verified teachers post their end-of-term question sets with the **school they come from**, set a price, and sell. Each item shows its source, for example **Chemistry · Opoku Ware School** or **English · VPCS**. Buyers pay with Paystack (mobile money or card); the cart (set, subject, school, class, teacher, price) is sent to Paystack as the payment's metadata and recorded on the payment. A paid set stays in the buyer's account for **90 days**.

The agreed rules (all adjustable in Admin settings, except where noted):
- **Sellers:** verified teachers only. QuizBox checks the details and the payout account name, then verifies them (Admin, Marketplace, Sellers).
- **Sets:** price in whole cedis from **GHS 5 to GHS 200**; 10 to 200 questions; every set is approved by QuizBox before it is on sale (Admin, Marketplace, Sets to review). The review screen shows how many questions match another seller's wording. A rejected set comes back with the reason.
- **Split:** **60% to the teacher, 40% to QuizBox**, worked out in pesewas at the time of sale (the teacher's share is rounded down; QuizBox keeps the rest, so the two always add up to the price). Paystack's fee comes out of QuizBox's 40%.
- **Hold:** a sale can be requested **7 days** after it was made (the refund window).
- **Payout:** the teacher sees "sales, less QuizBox's 40%, less any refunds = you receive", approves it, and the request is due **within 24 hours on working days** (Monday to Friday; a Friday request is due Monday 17:00, a weekend request is counted from Monday). Finance pays by hand to the account shown on the request and marks it paid with the transfer reference. Smallest payout: GHS 20 (setting `marketplace.min_payout_minor`).
- **Refunds:** refunding a Marketplace purchase on the Paystack dashboard reverses the sale by itself (the buyer loses the set, the teacher's share is taken back). If a refund comes after a payout, the teacher's balance goes negative and their next sales settle it first.
- **Switch:** the Marketplace is **closed** until you open it (Admin, Marketplace, Merchant account). Teachers can register and prepare sets while it is closed.

## 1. Database (nine parts, then the guides)
Supabase, project `fmgccmqxfjppqydkhaiu`, SQL editor. For each part: run the copy command in PowerShell, paste into a new query, Run, expect "Success". Run them in order. Safe to run twice. Nothing existing is changed; the older `marketplace_*` tables are left alone.

Part 1:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\marketplace\mk1.sql" -Raw | Set-Clipboard
```
Part 2:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\marketplace\mk2.sql" -Raw | Set-Clipboard
```
Part 3:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\marketplace\mk3.sql" -Raw | Set-Clipboard
```
Part 4:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\marketplace\mk4.sql" -Raw | Set-Clipboard
```
Part 5:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\marketplace\mk5.sql" -Raw | Set-Clipboard
```
Part 6:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\marketplace\mk6.sql" -Raw | Set-Clipboard
```
Part 7:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\marketplace\mk7.sql" -Raw | Set-Clipboard
```
Part 8:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\marketplace\mk8.sql" -Raw | Set-Clipboard
```
Part 9:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\marketplace\mk9.sql" -Raw | Set-Clipboard
```
The two Help guides (saved as drafts):
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\marketplace\mkguide1.sql" -Raw | Set-Clipboard
```

Verify (expect 43, then 7, then 9 rows, then 2 rows, then 7 rows with `rls_on` = `true`):
```sql
select count(*) as functions from pg_proc where pronamespace='public'::regnamespace and proname like 'qb\_mk\_%';
select count(*) as tables from information_schema.tables where table_schema='public' and table_name in ('mk_sellers','mk_items','mk_questions','mk_purchases','mk_payouts','mk_ledger','mk_attempts');
select key, value from public.platform_settings where key like 'marketplace.%' or key = 'flags.marketplace' order by 1;
select slug, state from public.help_articles where slug in ('sell-question-sets','buy-a-question-set') order by 1;
select c.relname, c.relrowsecurity as rls_on from pg_class c where c.relnamespace='public'::regnamespace and c.relname in ('mk_sellers','mk_items','mk_questions','mk_purchases','mk_payouts','mk_ledger','mk_attempts') order by 1;
```
The settings should show `flags.marketplace` = `false`, `marketplace.access_days` = 90, `hold_days` = 7, `seller_share_percent` = 60, `min_price_minor` = 500, `max_price_minor` = 20000, `min_payout_minor` = 2000, `min_questions` = 10, `max_questions` = 200.

## 2. Try it before opening it (nothing is charged; buyers see "not open yet")
1. As a **teacher test account**: open **Sell question sets**, apply (use real-looking details; the payout account is not used until you pay someone).
2. As **you (owner)**: Admin, Marketplace, **Sellers**: Verify the teacher.
3. As the teacher: add a question set (10 or more questions pasted in the format shown on the page, price e.g. GHS 5) and press **Save and send for review**.
4. As you: Admin, Marketplace, **Sets to review**: open it, approve it.
5. Admin, Marketplace, **Merchant account**: **Open the Marketplace**.
6. As a **different** account (a learner or another teacher): Marketplace, open the set, **Buy**. On live Paystack this is a real GHS 5 payment (use Preview with Paystack test mode if you would rather not spend money). After paying you return to **My question sets**; the set appears within a few seconds. Practise it.
7. As the teacher: **Sell question sets** shows 1 sale, GHS 5 paid, GHS 3 yours (60%), held for 7 days. The **Get paid** panel says nothing is available yet.
8. Optional, to see a payout without waiting 7 days (SQL editor, test data only):
   ```sql
   update public.mk_ledger set available_at = now() - interval '1 minute' where kind = 'sale';
   ```
   Then in the teacher account the **Get paid** panel shows the calculation (the smallest payout is GHS 20 by default, so make several test sales or lower the setting). Approve it, then in Admin, Marketplace, **Payouts** you see the destination account in full: pay it from your mobile-money or bank app, enter the transfer reference, and press **Mark as paid**.
9. Publish the two Help guides (Admin, Help guides): "Sell your end-of-term questions" and "Buy and practise a question set".

## Rules built in
- The price comes from the database, not the browser; the amount sent to Paystack is checked against it; a set's price cannot change between checkout and payment.
- A repeated Paystack callback never records a sale twice; a double click on Buy returns the same payment for ten minutes.
- A seller cannot buy their own set; a managed child cannot pay; a set you still hold is not sold to you again.
- Buyers get the questions with answers only while their 90 days run (and the seller and reviewing staff); sample questions on a listing never include answers.
- Payout details are shown masked to the teacher and in full only to finance. Changing payout details sends a verified seller back to "pending" so you check them again.
- A payout request reserves exactly the amount shown; a stale amount is refused and the teacher sees the new one. Rejecting or cancelling returns the money to the balance. Every finance action is in the audit log.
- Pausing a seller takes all their sets off sale at once; buyers keep what they already bought.
- Rollback: `supabase/rollback/marketplace.sql` removes the Marketplace functions only. Sales, the ledger and payout records are kept on purpose.

## Please review before opening to the public
- The **seller terms** shown when a teacher applies are a plain summary. Have a lawyer review them (and your Terms and Refund Policy) for marketplace sales, and confirm the tax position of QuizBox Solutions on the 40% and any withholding or reporting duties on payouts to teachers.
- Paying teachers by hand to a name-matched account is the safe start. Automatic Paystack transfers can be added later.
