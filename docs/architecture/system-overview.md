# System overview (as found in the code, 2026-10-21)

```mermaid
flowchart LR
  V[Visitor / learner / teacher / sponsor / admin browser] -->|HTTPS| W[www.quizbox.io on Vercel]
  W --> P[(public) pages: ISR + server components]
  W --> A[(app) pages: client shell AppShell]
  W --> R[API route handlers: 21]
  A -->|supabase-js with user JWT| S[(Supabase: Postgres + Auth + Storage)]
  P -->|service role, server only| S
  R -->|user JWT or service role| S
  R --> PS[Paystack]
  R --> RS[Resend email]
  PG[pg_cron in Supabase] -->|Bearer CRON_SECRET| R
  PS -->|signed webhook| R
```

Key boundaries

1. **Browser to Supabase**: the signed-in app talks to Postgres through PostgREST with the user's JWT. Every table has RLS; writes go through `SECURITY DEFINER` RPC functions that check the caller's role.
2. **Server to Supabase**: public pages and some routes use the service role (`getSupabaseAdminClient`). It must never reach the browser; it is read only from `process.env` in server files.
3. **Money**: Paystack initialise (server) -> buyer pays at Paystack -> signed webhook -> ledger event -> `qb_fulfil_subscription_payment`. The price is never taken from the browser.
4. **Schedulers**: pg_cron calls `/api/cron/push` (notifications and draft sweep) with a bearer secret; Vercel cron calls `/api/cron/managed-erasure` weekly.

```mermaid
flowchart TD
  CUR[Curriculum: authority > curriculum > node tree\nstrand / sub-strand / indicator] --> Q[questions]
  Q --> BAT[Question batches: load > review > approve > active]
  Q --> PR[Practice / assessments / assignments]
  Q --> CH[Challenges and competitions\n(bank questions or typed/uploaded material)]
  CH --> ST[stages, participants, attempts, awards]
  PR --> AT[attempts, responses, scoring RPC]
  PAY[price_list > Coins > wallets > access_entitlements] --> PR
```

Technical-debt register (selected): no CI (QB-AUD-005); silent catch blocks (QB-AUD-012); client-side route gating (QB-AUD-006); large data folders living in the repo working tree (`Questions Bank`, `_work`, `scratch`); 106 migrations applied by hand through paste parts (reproducible but manual; `docs/release/*` guides).
