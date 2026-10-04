# Proposal: public interest intake contract

Status: **PROPOSED — awaiting owner approval.** No migration has been created and no backend has changed.
Proposed SQL: [`public_interest_submissions.sql`](public_interest_submissions.sql). It is kept outside
`supabase/migrations` on purpose.

## Why one contract

The public site has five expression-of-interest forms: sponsor interest, non-teacher SME application,
school/institution interest, country interest and general contact. None of the existing tables can
take anonymous submissions safely:

| Existing mechanism | Why it is not reused |
| --- | --- |
| `public.support_tickets` | No category column. Its insert policy (`support_insert_authenticated`) is named and intended for signed-in requesters. Opening it to anonymous marketing leads would be an unreviewed widening of access. |
| `public.market_change_requests` | Signed-in users only; revoked from anon. |
| `sponsor_profiles` / `sme_profiles` / `institutions` | Real accounts and privileges. Anonymous submissions must never create them. |
| `quizbox_private.operation_budgets` | Keyed by `auth.uid()`, which anonymous visitors do not have. |

So the proposal is one governed table with a category, not five tables.

## Data contract

`quizbox_private.public_interest_submissions` (private schema, not exposed by PostgREST, RLS on, no grants):

| Column | Rule |
| --- | --- |
| `id` | uuid, generated |
| `category` | `SPONSOR` · `SME` · `SCHOOL` · `COUNTRY` · `CONTACT` |
| `name` | 2–150 chars |
| `email` | 6–254 chars, basic email shape, stored lower-case |
| `phone` | optional, `[0-9+() .-]{6,32}` |
| `country_code` | optional ISO-3166 alpha-2 (upper-case) |
| `country_name` | optional, ≤ 80 chars (free-text country from the form) |
| `organization` | optional, ≤ 200 chars |
| `subject` | optional, ≤ 200 chars (SME subject expertise) |
| `message` | 1–2000 chars |
| `metadata` | JSON object ≤ 4 KB; **only allowlisted string keys per category** (below), each ≤ 300 chars |
| `consent_at` | set server-side; submission refused without consent |
| `client_hash` | SHA-256 of client IP + server secret salt (64 hex). No raw IP is stored. |
| `status` | `NEW` → `IN_REVIEW` · `CONTACTED` · `CLOSED` · `SPAM` |
| `created_at`, `reviewed_at`, `reviewed_by`, `review_note` | audit trail |

Metadata allowlist (anything else is rejected, so arbitrary JSON is never accepted):

| Category | Allowed metadata keys |
| --- | --- |
| SPONSOR | `sponsor_type`, `intended_audience` |
| SME | `education_levels`, `professional_role`, `years_experience` |
| SCHOOL | `institution_type`, `estimated_learners`, `contact_person` |
| COUNTRY | `role`, `curriculum` |
| CONTACT | `enquiry_type` |

## Write path (anonymous browser → server only)

1. The browser POSTs the form to a new Next.js route, `app/api/public/intake/route.ts`. The browser never talks to Supabase for this.
2. The route enforces:
   - same-origin `Origin` header, `Content-Type: application/json`, and a body of at most 8 KB;
   - a honeypot field that must be empty, plus a minimum time-to-submit of 3 seconds;
   - validation with a shared validator (`lib/public/intake-validation.ts`, unit-tested). It mirrors the database constraints, trims input and rejects unknown fields;
   - `client_hash = sha256(ip + INTAKE_HASH_SALT)`. `INTAKE_HASH_SALT` is a new server-only secret.
3. The route calls `quizbox_private.submit_public_interest(p, client_hash)` using the existing server-only `getSupabaseAdminClient()` (service role). That function is executable **only by `service_role`**, so the service key never leaves the server.
4. The response is a generic `202 { ok: true }`, `400` or `429`. Submitted data is never echoed back. Rate-limited and failed responses stay generic.

Durable abuse limits, enforced in the database (`quizbox_private.intake_budgets`):

| Key | Limit |
| --- | --- |
| per client hash | 5 / hour, 20 / day |
| per email + category | 3 / day |
| global | 300 / hour |

Optional hardening for the owner to decide: Cloudflare Turnstile or hCaptcha on the route. It needs site and secret keys, which are not configured today.

## Read path (staff only)

`public.qb_admin_public_interest(action, data)`:
- Executable by `authenticated`, but the first line requires `quizbox_market.is_super()`, the same gate as `qb_admin_ops`. It is never executable by anon.
- `list` is paged (at most 200 rows) and filterable by category and status. It never returns `client_hash`.
- `review` sets the status, `reviewed_at`, `reviewed_by` and a note.

A small admin page (for example `/admin/intake`) would call this RPC. That page is out of scope until the contract is approved.

## Security-readiness impact

- No new anonymous-executable function. `security-readiness.ts` stays unchanged and `rpc_anonymous_execute` is unaffected.
- Both new tables have RLS enabled, so `public_rls` is unaffected.
- The new definer RPC is admin-gated, so it should be inventoried as "authenticated with role checks".

## Verification done for this proposal

The proposed SQL was applied to an in-memory PostgreSQL (PGlite, the repo's existing dev dependency) with minimal stubs for `auth.uid()`, `quizbox_market.is_super()` and `public.profiles`. 20/20 checks passed:

- valid submission, and normalization of category, email and country code;
- rejection of an unknown category, missing consent, a disallowed metadata key, non-string metadata, a bad client hash, a bad email and an oversized message;
- the per-client hourly limit and the per-email-plus-category daily limit;
- no table access for anon or authenticated, and the submit function executable by `service_role` only;
- the admin RPC not executable by anon, and RLS enabled on both tables;
- non-super denied; super can list (`client_hash` hidden, limit applied) and review; an invalid review status is rejected.

Not yet verified: application against a real Supabase project (acceptance branch first).

## Decisions needed from the owner

1. Approve the single-table contract and the category list.
2. Retention period for submissions. This must also appear in the approved privacy notice, which does not exist yet.
3. Who reviews submissions: Super Admin only (as proposed), or a narrower capability.
4. Whether to add Turnstile or hCaptcha.
5. Approve the new server secret `INTAKE_HASH_SALT`.

## Implementation steps after approval

1. Copy the SQL into `supabase/migrations/<timestamp>_public_interest_intake.sql` and add the rollback file. Apply to acceptance only.
2. Add `lib/public/intake-validation.ts` with tests, plus `app/api/public/intake/route.ts`.
3. Flip `INTAKE_STATUS` in `lib/public/intake.ts` to open, per category, and add the submit handler to `InterestForm`.
4. Live acceptance tests (anonymous submit, rate limits, admin list and review), then the production activation checklist.
