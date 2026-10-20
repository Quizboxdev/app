# Pricing table plan (design only, nothing built yet)

Goal: the owner sets every price and its payment link in one admin screen. The website shows the active prices. A click sends the buyer to the payment gateway's cart URL. No price is typed into code.

## Today
- Plans live in `config/subscription-plans.json` (names, audience, what is included, `coins` and `days`). The cedi price is Coins × one unit price set in Admin, Access and Subscriptions. `/subscribe` calls `startCheckout`, and the server opens a gateway checkout.
- `/pricing` (public) and `/subscribe` show "Price to be announced" until a price exists. Challenges and campaigns have no price anywhere.

## Proposed table `public.price_list`
| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| kind | text | `plan`, `campaign`, `bundle`, `other` |
| code | text unique | stable key used by the front end, e.g. `learner_monthly`, `challenge_host_basic` |
| name | text | shown to buyers |
| audience | text | `learner`, `teacher`, `school`, `host`, `sponsor`, or a campaign id |
| description / includes | text / jsonb | the bullet list shown on the card |
| period | text | `month`, `term`, `year`, `campaign`, `once` |
| price_minor | integer null | pesewas; null shows "Price to be announced" |
| currency | text | `GHS` |
| checkout_url | text null | gateway cart/payment link; https only, validated |
| active | boolean | only active rows are public |
| starts_at / ends_at | timestamptz null | optional sale window |
| sort_order | integer | |
| grants | jsonb null | what a paid purchase unlocks (e.g. `{"days":30}` or `{"campaign":"<id>"}`), applied by the payment confirmation |
| created_at / updated_at / updated_by | | audit |

## Access
- `qb_price_list()` returns active rows inside their window to anyone (anonymous included): no checkout URL for a row without a price, and never `grants`.
- `qb_price_list_admin()`, `qb_price_set(...)`, `qb_price_retire(id)`: owner/admin only, every change audited. Prices are never deleted, only retired, so past payments keep their meaning.
- Row Level Security on, no direct table grants, functions with fixed `search_path` (house standard).

## Front end
- `/pricing` and `/subscribe` read `qb_price_list()`; a card with a price and a `checkout_url` shows a Pay button that goes to the link; otherwise "Price to be announced". Challenge hosts see their price when creating a challenge.
- Admin: one screen "Prices and payment links" with a row per item, price in cedis, link field, active switch, and a preview.

## Payment confirmation
A checkout URL alone cannot tell QuizBox who paid. Two options (open question 1): (a) keep the current server-created checkout with a reference and webhook for subscriptions, and use `checkout_url` only for items the webhook cannot yet fulfil; (b) pass a reference into every link and confirm by webhook for all items. Without (b), a paid link needs a manual "activate" step by an admin.

## Migration from today
1. Insert one `price_list` row per plan in `subscription-plans.json` with `price_minor = null` (nothing changes for buyers).
2. Add rows for challenge hosting and school plans.
3. When the owner sets prices, the Coins × unit price model is retired for plans: `planPriceMinor` is replaced by the row price. Coin balances and past payments are untouched. The unit price setting stays for Coin top-ups only if Coins remain a product.
4. Rollback file in `supabase/rollback/price_list.sql`.

## Open questions for the owner
1. Which gateway, and can it add a payer reference to a cart link and call us back (webhook)? That decides option (a) or (b) above.
2. Do Coins stay as a product, or are prices in cedis only?
3. Who pays for a challenge: the host (flat fee per challenge) or the sponsor, and is there a free tier?
4. Are teachers free? Is there a school price per learner or a flat annual fee?
5. Refund and failed-payment handling: manual by admin, or automatic?
6. Should prices differ by market (Ghana first, other currencies later)?
