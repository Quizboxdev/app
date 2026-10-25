# 06. Monetisation and rewards policy (working document)

Date: 2026-10-25. **Status of every number below: proposed pilot configuration, not live policy**, unless the Status column says "In code" and a policy version has been approved by the owner. Nothing here is a legal opinion. Items needing counsel are in `13_OPEN_DECISIONS_AND_RISKS.md`.

## 1. Separate accounting identities

| Concept | Unit | Cash? | Where it lives | Rule |
|---|---|---|---|---|
| Subscription / purchase revenue | GHS minor units | yes (received) | `payment_intents`, `payment_events` | Only a verified Paystack event settles |
| QuizBox Coins | whole Coins, 1 Coin = GHS 1 convention | **no**: not cash, not withdrawable, not transferable | `wallets`, `coin_transactions` | Purchased Coins do not expire by default |
| XP | points | no | learning events | Academic activity only |
| QPoints | points | no | `qpoint_transactions` | Reward credits |
| Affiliate commission | GHS minor units | yes (paid out) | `commission_accruals`, `commission_ledger` | Cash liability of QuizBox |
| Regional manager commission | GHS minor units | yes | same ledger, `kind = 'manager'` (planned) | Shares the acquisition cap |
| Marketplace royalty | GHS minor units | yes | `mk_ledger` | Percentage from policy |
| SME reviewer fee | per review | yes | `quizbox_sme` earnings | Compensation policy versions |
| Prize obligation | per programme | goods or (after legal review) cash | `challenge_prizes`, funding lines (planned) | From restricted sponsor funds only |

Mastery, proficiency and accuracy are academic measures and never convert into money.

## 2. Affiliate programme (Release C-1)

| Rule | Value | Status |
|---|---|---|
| Who | Adults only; not minors; not teacher-managed learners; staff verify identity before approval | In code (adult account check + staff identity confirmation) |
| Joining cost | none; no recruitment fee; no commission for recruiting affiliates; direct referrals only | In code (no downline field exists) |
| Tiers | Registered 10 %, Growth Partner 12.5 %, QuizBox Ambassador 15 % | Proposed; seeded as a **draft** policy |
| Tier thresholds | Growth after 10 verified paid direct referrals in 90 days; Ambassador after 30 | Proposed pilot values |
| Attribution | first touch, server side, 30-day window, one per customer, immutable | In code; window from policy |
| What earns | the **first** eligible purchase of a referred customer; eligible purposes = subscriptions | In code; `recurring_enabled` cannot be true |
| Base | payment amount less the tax share (policy percentage, 0 until decided); refunds reverse | In code; tax percentage is **open decision F-1** |
| Self-referral | refused at capture and again at payment | In code |
| Unpaid or fake subscriptions | no accrual unless settled **and** the subscription was granted | In code |
| Hold | 30 days then approved | Proposed; from policy |
| Refund or chargeback | explicit reversal row; after approval or payment the available balance goes negative and later earnings offset it | In code |
| Minimum payout | GHS 50 | Proposed; stored; enforced in the payout release (C-2) |
| Payout | monthly, by hand, maker–checker | C-2 |
| Cap | combined affiliate + manager share of one sale ≤ 15 % of eligible net revenue | In code (cap enforced when accruing; manager kind arrives in F) |
| Renewal commissions | **disabled** | CHECK constraint |

### Worked examples (from the tests)

- GHS 25 monthly plan, registered tier: net 2,500 → 10 % = **GHS 2.50**, held 30 days.
- GHS 40 plan, third qualifying referral with a policy rate of 20 % and cap 15 %: raw 800, allowed 600, **200 clipped and recorded**.
- GHS 23 plan with 15 % tax inside the price: tax 300, net 2,000 → 10 % = 200.
- Refund while held: the 250 disappears from pending. Refund after approval: available falls by 250. Refund after a payout: available goes negative until later earnings offset it.

## 3. Affiliate vs regional manager (Release F)

One sale may carry at most the cap (default 15 %) of combined acquisition commission. Illustration only: affiliate-introduced, manager-closed school sale = 5 % referral + 10 % manager. Direct affiliate sale = affiliate tier rate. Manager-only sale = manager rate. The engine clips the later accrual so the total never passes the cap. The cap is **not** applied to teacher royalties, reviewer fees, prize budgets or sponsorship management fees.

## 4. Subscriber referral rewards (Release C-2)

Eligible adult subscribers can earn QuizBox Coins or approved learning credits for qualifying direct referrals. Posted through existing wallet functions with an idempotency key tied to the payment reference; reversed with the payment. Coins from referrals are non-cash, non-transferable and non-withdrawable. Children never receive cash commissions; child referral benefits need a linked adult.

## 5. Marketplace (existing, flag off)

60 % publisher / 40 % QuizBox as a setting today; moving to a versioned royalty policy (Release G) so that changing the percentage never rewrites history. 7-day hold; payouts by hand within 24 working hours; refund takes the share back. Treat 60/40 as a policy option, not a commitment (directive §7).

## 6. Prizes and chance-based promotions

Real-cash prizes and chance-based promotions stay **off** until counsel confirms what Ghana's competition, gaming and consumer rules require. Prize rows of kind `cash` exist in the schema; Release D adds a rule that a cash prize cannot be published unless a flag and a recorded legal decision exist.

## 7. What is explicitly not decided here

Final subscription prices; tax treatment of commissions and of QuizBox's marketplace share; whether affiliates are treated as independent contractors; payout withholding; marketplace royalty percentages beyond 60/40; SME fee levels; prize regulations; sponsor contract terms; white-label commercial terms. Each is a row in the decision register.
