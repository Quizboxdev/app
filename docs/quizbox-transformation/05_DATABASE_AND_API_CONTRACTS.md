# 05. Database and API contracts

Date: 2026-10-25. Covers objects added or changed by the transformation. Release C-1 (migration `20261048100000_affiliate_commission_foundation.sql`) is built and tested; later releases are listed as planned so the shape is agreed before code. For each object: rationale, migration method, affected APIs, compatibility impact.

## 1. Release C-1: affiliates, referral attribution, commission ledger

**Rationale.** The platform has no way to attribute a customer to a referrer or to pay a commission. Adding it as consequences of the existing settled-payment path avoids a second payment engine. **Method:** one additive, idempotent migration (`create ... if not exists`, `create or replace`), rollback script that removes functions and keeps records. **Compatibility:** no existing table or function changes; `fulfilAfter()` gains two steps that do nothing when the programme flag is off or the migration is absent.

### Tables (all row-level-security on, all privileges revoked from `anon` and `authenticated`)

| Table | Purpose | Key constraints |
|---|---|---|
| `commission_policies` | Versioned rules | `version` unique; status draft / approved / retired; `recurring_enabled` has `CHECK (= false)`; `ambassador_min > growth_min`; trigger blocks any edit to a non-draft row except retirement |
| `affiliates` | One per adult applicant | `user_id` unique; `referral_code` unique `^[A-Z0-9]{6,12}$`; adult attestation and terms timestamps `NOT NULL`; status applied / approved / suspended / rejected / terminated |
| `affiliate_payout_details` | Payout destination | one row per affiliate; account digits only; never returned in full |
| `referral_attributions` | Who referred whom | `referred_user_id` unique (first touch wins); `qualified_payment_ref` unique; trigger: identity columns immutable, status only moves from pending |
| `commission_accruals` | One per commission | unique `(payment_reference, kind)`; `gross = tax + net`; trigger: money columns immutable, a reversed row never reopens |
| `commission_ledger` | Append-only money trail | buckets pending / available / reserved / paid; `amount_minor <> 0`; update and delete always raise `QB_LEDGER_IMMUTABLE`; one accrual, release and reversal row per accrual per bucket |

### Functions

| Function | Who may call | Result / behaviour |
|---|---|---|
| `qb_affiliate_apply(name, phone, adult, accept_terms)` | signed-in adult (not minor, not managed) when `flags.affiliates` | creates or re-opens an application; returns `{id, status}` |
| `qb_affiliate_me()` | signed-in | own status, tier, code (only when approved), masked payout |
| `qb_affiliate_payout_save(method, network, account, account_name)` | own affiliate | upserts details; any change clears verification |
| `qb_affiliate_summary()` | own affiliate | balances by bucket, referral counts, policy summary, last 20 commissions; **no customer identity** |
| `qb_referral_capture(code, source, campaign)` | signed-in customer | outcome: attributed / already_attributed / invalid_code / self_referral / existing_customer / programme_off |
| `qb_commission_accrue(reference)` | **service role only** (settlement code) | outcome: accrued / already_accrued / not_settled / programme_off / no_approved_policy / not_eligible / not_fulfilled / no_attribution / not_first_purchase / attribution_rejected / attribution_expired / affiliate_not_active / self_referral / nothing_due |
| `qb_commission_reverse(reference, reason)` | **service role only** | reverses every open accrual on that payment; outcome reversed / none |
| `qb_commission_policies_list()`, `qb_commission_policy_save(...)`, `qb_commission_policy_approve(id)` | owner, super admin, finance admin | save creates the next draft version; approve retires the previous version; self-approval only by super admin and audited |
| `qb_affiliate_admin_list(status)`, `qb_affiliate_decide(id, action, note, identity_verified)` | same staff | actions approve / reject / suspend / reinstate / terminate; approve needs identity check + payout details + adult account |
| `qb_commission_admin_summary()`, `qb_commission_admin_accruals(status, limit)`, `qb_commission_admin_reverse(reference, reason)` | same staff | reconciliation numbers; list names affiliates, not customers |
| `qb_cm_*` helpers | none (internal) | policy lookup, tier, adult check, notify, release holds |

### State machines (enforced by function guards and CHECK constraints)

- Affiliate: applied → approved → suspended ⇄ approved; approved/suspended → terminated; applied → rejected (re-apply allowed).
- Attribution: pending → qualified | rejected, then frozen.
- Commission: pending → approved (after hold) → payable → paid; pending/approved/payable/paid → reversed. C-1 implements pending, approved and reversed; payable and paid arrive with payouts (C-2).
- Policy: draft → approved → retired.

### Money rules in code

Net revenue = payment amount − `round(amount × tax% / (100 + tax%))`. Raw commission = `floor(net × tier rate / 100)`. Cap amount = `floor(net × cap% / 100)`; commission = `min(raw, cap − commissions already accrued on that payment)`; the clipped part is stored in `cap_clipped_minor`. Tier = count of the affiliate's non-reversed accruals in the policy window before this sale. Hold: `release_at = settled_at + hold_days`; `qb_cm_release_holds()` moves due rows to available (called when an affiliate or staff member opens their summary).

### Application contract

`lib/payments/settlement.ts → fulfilAfter()` calls `qb_commission_accrue` after a credited/duplicate/already-settled payment and `qb_commission_reverse` after a refund/reversal. "Function not found" is treated as nothing to do; any other error answers 500 so the provider retries (the functions are idempotent). Client wrappers: `lib/api/affiliates.ts`; referral link and cookie: `app/r/[code]/route.ts`, `lib/referral/*`, applied in `components/AppShell.tsx`.

### Rollback

`supabase/rollback/affiliate_commission_foundation.sql` sets the flags false and drops every `qb_affiliate_*`, `qb_commission_*`, `qb_referral_*` and `qb_cm_*` function except the immutability trigger function. Records and triggers stay. Tested to leave payments unaffected and to be re-appliable.

## 2. Planned objects (shape only; no code yet)

| Release | Objects | Notes |
|---|---|---|
| C-2 | `affiliate_payouts`, ledger kinds `payout_reserved/payout_paid`, `referral_rewards` rule table, maker–checker above a threshold | payout approvals by two finance users; Coins rewards through existing wallet functions |
| B | `institution_verifications`, `school_subscriptions`, entitlement link, `school_seat_usage` view | payer ≠ beneficiary validated; no price hard-coded |
| D | `competition_templates`, `result_verifications`, `result_appeals`, `certificates`; campaign columns `sponsor_program_id`, geographic scope | extends `challenge_campaigns`, no new engine |
| E | `sponsor_programs`, `sponsor_agreements`, `sponsor_funding`, `programme_profiles`, `programme_representatives` | funding lines restrict prize and access budgets |
| F | `territories`, `territory_assignments`, `crm_opportunities`, `crm_activities`, manager commission accrual kind | `commission_accruals.kind` CHECK widened by migration |
| G | `mk_royalty_policies` (versioned), publisher-type column on `mk_sellers` | historical purchases keep the rate they were sold under |

## 3. Existing contracts that must not change

`qb_payment_intent_create`, `qb_payment_apply_event`, `qb_fulfil_subscription_payment`, `qb_mk_fulfil_purchase`, the webhook signature check and `payment_intents.metadata.purpose` values (`subscription`, `marketplace`, derived `coins`) are relied on by the commission engine. Any change to them needs the commission tests re-run (`lib/core/affiliate-commission-sql.test.ts`).
