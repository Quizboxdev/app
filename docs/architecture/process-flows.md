# Process flows (as implemented)

## Join a challenge from a shared link

```mermaid
flowchart TD
  L[Shared link /challenges/slug] --> P[Public page: title, rounds, leaderboard]
  P -->|Play now| PL[/play/slug in the app]
  PL -->|no session| LG[Sign in or sign up, then return]
  PL -->|session| J[challenge_join RPC]
  J -->|free sessions left or plan| OK[Play timed round]
  J -->|allowance used| SUB[Subscribe]
  OK --> LB[Server scores answers; leaderboard]
```

## Pay for Coins or a plan

```mermaid
sequenceDiagram
  participant B as Browser
  participant R as /api/payments/checkout
  participant D as Database
  participant P as Paystack
  participant W as /api/payments/webhook/paystack
  B->>R: plan code + Bearer JWT
  R->>D: price list; unit price; minor check
  R->>D: qb_payment_intent_create (amount must equal Coins x unit)
  R->>P: initialise exact amount
  P-->>B: hosted payment page
  P->>W: signed event
  W->>W: verify HMAC; re-query transaction
  W->>D: ledger event; qb_fulfil_subscription_payment (idempotent)
  B->>B: return to /subscribe?reference=...
```

## Authorization boundary

Browser role checks (AppShell) decide what is shown. The database decides what is allowed: RLS and role checks inside each RPC. A forged URL can show an empty page shell but not data.
