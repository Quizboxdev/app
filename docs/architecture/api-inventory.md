# API route inventory (21 handlers)

| Route | Caller | Authentication in code | Notes |
|---|---|---|---|
| POST /api/payments/checkout | signed-in payer | Bearer JWT, `getUser` | Price from Coins x unit; minors blocked; Paystack initialise |
| POST /api/payments/webhook/[provider] | Paystack | HMAC-SHA512 signature | 64 KB cap; unknown provider 404; idempotent settlement |
| POST /api/teacher/learners, /reset, /archive | teacher | `authenticate` + SQL pair authorisation | Rate-limited per teacher |
| POST /api/admin/managed-learners/erase | admin | `authenticate` | Privacy erasure |
| POST /api/admin/content-factory/run | admin | Bearer JWT | |
| POST /api/admin/curriculum-sources/fetch, /upload | super admin | Bearer JWT + SQL authorisation | Official-host allow-list |
| POST /api/content/media | signed-in user | Bearer JWT, `getUser` | Authorisation beyond sign-in not reviewed |
| POST /api/challenges/content | signed-in creator | `authenticate` | 8 MB cap; PDF/DOCX/TXT; rights tick required |
| POST /api/challenges/view | any browser | Origin header only | QB-AUD-007 |
| GET /api/cron/drafts, /managed-erasure, /push | scheduler | Bearer `CRON_SECRET`, constant-time | Closed unless secret set |
| POST /api/generation/curriculum | Content Factory | Bearer shared key (digest compare) | Closed unless key set |
| POST /api/ops/client-error | browser | Same-origin check; DB scrubs and caps | Always 204 |
| POST /api/ops/refresh-analytics | operator | `x-qb-ops-secret` (plain compare) | QB-AUD-008 |
| POST /api/public/intake | public forms | HMAC + honeypot | |
| POST /api/sponsor/source, /workspace | sponsor | `sponsorRequestClient` (user JWT) | |

Most application reads and writes do not use these routes: they are direct Supabase RPC calls (see `lib/api/*`), generated into `docs/api/MOBILE_API_CONTRACT.md`.
