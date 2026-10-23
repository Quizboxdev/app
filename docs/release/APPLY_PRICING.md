# Turning on the price list (migration 20261030100000)

The pricing page, the in-app subscribe cards and the admin screen (Admin, Prices) are deployed. Until you apply the database change the pricing page shows the plans from the plan file ("Price to be announced") and the admin screen shows an error.

## 1. Apply (two parts)
Supabase, project `fmgccmqxfjppqydkhaiu`, SQL editor. Copy a part, paste into a new query, Run, expect "Success". Safe to run twice (it never overwrites prices you have set).
```
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\pricing\price1.sql" -Raw | Set-Clipboard
Get-Content "C:\Users\USER\OneDrive\Documents\QuizBox\Codes\QuizBox_Batch1_Student_Teacher_Assessment\docs\release\pricing\price2.sql" -Raw | Set-Clipboard
```
Verify (expect 8 rows, the starter prices):
```sql
select code, audience, period, price_minor, active from public.price_list order by audience, sort_order;
```

## 2. Set prices and payment links
Sign in as owner or admin, open Admin, then Prices. For each card: set the Coins (the cedi price follows: 1 Coin = GHS 1), tick "Show on the pricing page", Save. Leave the payment link empty: card and mobile-money plans use QuizBox's own checkout, which records who paid. A link is only for invoice or hand-confirmed sales (it must start with https://). The preview at the bottom shows exactly what visitors see. Empty price shows "Price to be announced"; 0 shows "Free".

## Rules
- A payment link is shown only when the price is above zero. A link opens the gateway but cannot say who paid: activate those buyers under Access and Subscriptions. For learner plans, leave the link empty to keep using the secure checkout that records who paid.
- Cards are switched off or given sale dates, never deleted. Every change is logged.
- Rollback: `supabase/rollback/price_list.sql` (removes the cards and prices).
