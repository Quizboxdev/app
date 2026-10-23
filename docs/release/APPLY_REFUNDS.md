# Turning on the refund tools (migration 20261035100000)

Admin, then Operations, then **Refunds** lets you find a payment, see what the refund policy needs (inside 7 days? Coins used? duplicate?), add Coins back for a duplicate charge, and record cash refunds and declined requests. Until you apply the database change, the page opens but says "That did not work" when you search.

## 1. Database (three parts, in this order)
Supabase, project `fmgccmqxfjppqydkhaiu`, SQL editor. For each part: run the copy command in PowerShell, paste into a new query, Run, expect "Success". Safe to run twice.

Part 1:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\refunds\refund1.sql" -Raw | Set-Clipboard
```
Part 2:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\refunds\refund2.sql" -Raw | Set-Clipboard
```
Part 3:
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\refunds\refund3.sql" -Raw | Set-Clipboard
```
Verify (expect 4 rows, then 1 row):
```sql
select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('qb_admin_payment_facts','qb_admin_refund_credit','qb_admin_refund_case_save','qb_admin_refund_cases') order by 1;
select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname='refund_cases';
```
The second query should show `refund_cases` with `relrowsecurity` = true.

## 2. Handling a request (matches the policy at /refunds)
1. A request arrives through the contact form ("Payment or refund"). Open Admin, Refunds, and search by the Paystack or QuizBox reference, or the buyer's email.
2. Read the facts line by line: inside 7 days, Coins credited, plan granted, Coins spent since, possible duplicate.
3. **Duplicate charge:** confirm both charges on the Paystack dashboard, then "Add Coins to the buyer's account". The extra comes back as Coins, never cash. It can be done once per case and never for more than the payment was worth. The buyer gets a message in the app.
4. **Paid but not applied:** apply the payment (Admin, Access and Subscriptions). If you cannot, and none of the purchase's Coins were used, refund the cash from the Paystack dashboard, then "Save outcome" with "Cash refunded". The system refuses a cash refund when Coins were used or the plan was granted.
5. **Anything else:** "Save outcome" as Declined, with the reason.
6. Reply to the buyer by email within 3 working days.

## Rules built in
- Only owners and finance admins can use any of it; the database checks every call.
- Older than 7 days is refused unless you tick the exception box; the exception is written to the audit log.
- Every Coin credit and every case change is audited. Rows are never edited from the browser.
- Rollback: `supabase/rollback/refund_cases.sql` (Coins already credited stay on the wallets).
