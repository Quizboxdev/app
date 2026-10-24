# 06 - Frontend / backend integration audit

**Evidence level.** Traces below were done by reading the code (`CODE`) and by the existing automated tests (1,426 passing). Only the payment and export traces were also exercised against real systems, earlier in this engagement, and those are marked. No signed-in browser session was available for this audit (see 03), so nothing here was reproduced through the UI. Observed defects and architectural risks are kept apart.

Trace format: **UI -> client API -> authorization -> business rule -> database -> response -> what the user sees.**

## 1. Student answers a question (assessment player)

| Hop | What happens | Evidence |
|---|---|---|
| UI | `app/(app)/student/attempt/[id]/page.tsx` `answer()` marks the answer selected immediately (optimistic), sets "Saving..." | CODE |
| Client API | `lib/api/assessment.ts` `saveResponse` -> `supabase.rpc("qb_save_response")` | CODE |
| Authorization | RPC checks the attempt belongs to `auth.uid()` | not re-verified here |
| Business rule | Timer deadline set at start (`greatest(time_limit_minutes, 1)` minutes, capped by the assessment's end), `qb_complete_attempt` on expiry | CODE (SQL fixture) |
| Response / UI | Success: "Saving..." disappears. Failure: `setError(message)` shows a red `role="alert"` banner | CODE |

**Observed in code (UNVERIFIED at runtime):**
- `setError` is never reset to an empty string anywhere in this component (search for `setError("")` returns nothing). One failed save leaves a red banner for the rest of the attempt, even after later saves succeed.
- Saves are chained as `pendingSave.current = previous.catch(() => {}).then(save)`. A failure in an earlier save is swallowed by the `.catch` and never retried. At submit, only the *latest* save is awaited, so an earlier answer whose save failed is submitted as unanswered while the screen still shows it selected. (UX-011)
- `saveResponse` does not call `recordFailure` (unlike `startAttempt` and `submitAttempt`), so failed saves are invisible to operations.
- Resume: `qb_get_attempt` returns saved answers and server-computed `remaining_seconds`; the page restores both but `index` starts at 0 (UX-012).

**Checked and not a defect:** an untimed attempt would get `remaining_seconds = 0` (SQL `greatest(NULL, 0)`) and the page would auto-submit. Attempt creation always sets a deadline, so this cannot occur today. Worth a one-line test if the SQL changes.

## 2. Identity bootstrap on every screen

`AppShell` calls `bootstrapUser()` (auth `getUser` request, then `profiles`, then the role's student/teacher profile), then `getSmeContext()`. **16 pages call `bootstrapUser()` again** (for example `/teacher`). Each navigation to such a page repeats at least three round trips already made by the shell. Not measured (no session). On a 400 ms round-trip connection the repeated calls alone would add over a second; that is arithmetic, not a measurement. (UX-013, architectural risk with strong code evidence.)

The two shell calls are sequential, so SME/finance menu entries appear after the first render (small layout shift) (UX-016, hypothesis).

## 3. Error translation

`unwrapRpc` in `lib/api/assessment.ts` turns database errors into text through `userFacingError` (`lib/errors.ts`: 83 `QB_*` codes mapped to plain sentences, everything else to one generic sentence). This is good design and keeps database wording out of the UI. Gaps:
- No mapping for network failure or timeout; a lost connection reads as a generic server problem and the app has no offline or "back online" handling (UX-022).
- Only 5 files under `app/` import `userFacingError` directly; 49 files put `e.message` into state. Most of them receive already-translated text from `lib/api`, so this is a code-hygiene risk (a page that calls Supabase directly would show a raw database message), not a proven user-facing defect.

## 4. Payments (exercised earlier against production and Preview)

UI "Pay" -> `POST /api/payments/checkout` or `/api/marketplace/checkout` (server computes the price, buyer cannot change it) -> Paystack -> **three independent delivery paths:** webhook (`/api/payments/webhook/paystack`, HMAC + server re-query), return-page confirm (`/api/payments/confirm`), and the admin "Payment checks" screen. All paths use the same event id for deduplication, so a replay grants once. Verified by tests (`payments.test.ts`, `confirm.test.ts`) and by a real GHS 40 production payment that was hand-settled once the missing webhook was found. Observed risk that remains: five old `initiated` subscription payments on production (4 x GHS 5, 1 x GHS 25) still need comparing with Paystack; owner action.

## 5. Admin exports

UI `ExportLink`/`/admin/exports` -> `GET /api/admin/export` -> permission group check (`qb_admin_*`) -> `qb_export_build_*` SQL builders -> JSON preview (limit 20) or file (limit 50,000, truncation flagged) -> CSV with BOM and formula-injection guard, or XLSX (real dates, filter row, About sheet). Verified: 31 datasets against the real database, 12 SQL tests, file and request unit tests.

## 6. Contracts and responses

- API success bodies are not uniform: some routes return `{ ok: true, ... }`, many return the payload directly. Error bodies are mostly `{ error: "UPPER_SNAKE_CODE" }` with matching HTTP status (400, 401, 403, 404, 409, 413, 500). One machine-to-machine route (`ops/refresh-analytics`) returns `{ error: "Unauthorized" }`. Consumers are the app's own pages, so there is no external contract break today; the mobile contract (`docs/api/MOBILE_API_CONTRACT.md`) already lists 265 functions, 39 table operations, 34 routes for future clients. Recommendation only.
- Duplicate submissions: marketplace checkout uses an idempotency key per item per 10-minute window; challenge view counts use a per-device budget; the quiz submit guards with a `submitting` ref. Payments are idempotent by event id.
- Pagination: list pages that can grow (access, compensation, reviewers, payouts, exports) have paging cues; support requests, tickets and refunds use filters without paging cues (scan; verify with volume).

## 7. Risks needing investigation, not defects

| Risk | Why it matters | How to investigate |
|---|---|---|
| N+1 or chatty loading on teacher/school dashboards | Several analytics calls per load | Network trace of `/teacher` with a seeded class |
| Stale dashboard indicators | Client-side state, no refresh/realtime | Change data in a second session, watch the first |
| Background job visibility | Content factory and question loading run long | Admin run with a 100-question batch on Preview |
| Server guard off in production | Signed-out visitors receive the app shell before redirect | Switch `QB_SERVER_GUARD=on` on Preview, repeat the signed-out test (3 routes redirected client-side at 1.2-2.5 s today) |
