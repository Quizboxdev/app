# Pre-login (anonymous) function review

Reviewed 2026-10-06 against the Preview branch (`fngdtxayfoiffbcbmcum`) definitions, grants and callers. **No function was changed.**
Production definitions were not read in this pass; verify them (and the index noted below) before relying on this review for production.

Scope: `public.qb_auth_failure`, `public.qb_signup_markets`, `public.qb_marketplace_catalog` — the three functions executable by the `anon` role.
Common facts: all three are `SECURITY DEFINER` and owned by `postgres`; `PUBLIC` execute has been revoked (ACLs list only `postgres`, `anon`, `authenticated`, plus `service_role` on the catalogue).

| Function | Verdict for production as-is |
|---|---|
| `qb_signup_markets` | **Acceptable.** Small, read-only, public display metadata. |
| `qb_marketplace_catalog` | **Acceptable now; follow-up needed** before the catalogue grows (unbounded result, no market scoping decision, loose `search_path`). |
| `qb_auth_failure` | **Not clean.** Already recorded as NEEDS_CHANGES (2026-10-04); this review confirms it and adds a table-grant finding. Tolerable only because writes are capped and the table is RLS-protected. |

---

## 1. `qb_signup_markets()`

- **Why anonymous:** the signup page must list countries/markets before an account exists (`lib/api/markets.ts`, `lib/public/signup-markets.ts`).
- **Read/write:** read-only, `STABLE`, one aggregate query over `countries` and `markets`. Returns country code/name, market id/name, locale and four configuration keys (`education_levels`, `grades`, `subjects`, availability flag) — not the whole `configuration` object.
- **Test markets:** hidden unless the `TEST_MARKETS_VISIBLE` feature flag is on, and countries that only have test markets are dropped.
- **Rate limiting:** none (anonymous callers have no `auth.uid()` for `consume_budget`). The query is small and bounded by the number of countries; scraping yields only data the signup page already shows.
- **Abuse potential:** low — enumeration of public market metadata, including active market UUIDs (required by signup). No per-user or tenant data.
- **Definer safety:** `search_path=''`, every relation schema-qualified, no dynamic SQL, no caller-controlled input. Safe.
- **Grants:** `anon`, `authenticated` — both needed (signup is pre-login; the same list is useful when logged in). Not broader than necessary.
- **Recommendation:** keep as-is. Optional: cache at the edge/CDN, since the result changes rarely.

## 2. `qb_marketplace_catalog()`

- **Why anonymous:** the public marketplace catalogue page (`lib/api/marketplace.ts`).
- **Read/write:** read-only, `STABLE`. Returns product id/type/title/description/subject/grade/licence/price/currency, seller display name and verification status, for products that are published **and** moderation-approved **and** from an active seller. No seller ids, emails or payout data are exposed.
- **Rate limiting:** none, and **no pagination or limit** — the whole matching set is returned on every call.
- **Abuse potential:** low today (Preview holds 0 products), but unbounded output becomes a scraping/cost vector as the catalogue grows. The result is also **not market-scoped**, so every market's published products are visible to everyone; confirm that is intended given the multi-market content rules.
- **Definer safety:** it bypasses RLS on `marketplace_products`/`marketplace_sellers` and re-implements the visibility rule in the `WHERE` clause (correct today). `search_path=public` (rather than `''`) is a hardening gap: only built-in functions are used unqualified, so the practical risk is low, but it should be `''`.
- **Grants:** `anon`, `authenticated`, `service_role` — all plausible; not broader than necessary.
- **Recommendation:** acceptable for production now. Follow-ups, in order: (1) add a bounded `p_limit`/`p_page` (cap ≤ 100); (2) set `search_path=''`; (3) decide and document whether the catalogue should be market-scoped.

## 3. `qb_auth_failure(p_code text)`

- **Why anonymous:** sign-in failures happen before authentication, and the app records them best-effort (`recordAuthFailure` in `lib/api/platform.ts`, which must never block sign-in). Anonymous execution is therefore necessary.
- **Read/write:** write-only, returns nothing. Inserts one `system_events` row (`event_type='AUTH_FAILURE'`, `severity='warn'`, `details.code`). It stops writing once 120 `AUTH_FAILURE` rows exist in the last minute.
- **Rate limiting:** a single **global** cap of 120/minute, not per source.
- **Abuse potential:**
  1. **Telemetry blinding:** one client can fill the global cap (120/min) and cause genuine failures to be dropped, hiding a real credential-stuffing attempt.
  2. **Log growth:** up to ~172,800 rows/day with no retention policy.
  3. **Free text:** `p_code` accepts 3–60 letters/spaces/underscores, so callers can store arbitrary words (including spoofed codes such as `invalid_credentials`). Letters-only limits injection risk, but the field is not a controlled vocabulary.
  4. **Cost per call:** each call runs `count(*)` over the last minute of `AUTH_FAILURE` rows. On Preview the supporting index `system_events_type_idx (event_type, created_at desc)` **exists**, which resolves the earlier "unverified index" concern there; it is not in tracked migrations, so **confirm it exists in production**.
- **Definer safety:** `search_path=''`, schema-qualified, fixed row shape, no dynamic SQL, parameters never executed. Safe as a function.
- **Table-level finding (defence in depth):** on `public.system_events`, both `anon` and `authenticated` hold `SELECT/INSERT/UPDATE/DELETE` table privileges. Only RLS (enabled, **zero policies** = default deny) keeps them out. Not exploitable today, but a future permissive policy or a disabled-RLS mistake would expose the table directly. Revoke direct table privileges from `anon`/`authenticated`; the definer function does not need them.
- **Grants on the function:** `anon`, `authenticated` — required; `PUBLIC` already revoked. Not broader than necessary.
- **Recommendation:** not acceptable to list as "clean" yet. Before treating it as reviewed: apply `docs/proposals/qb_auth_failure_hardening.sql` (allow-list of Supabase auth error codes instead of free text, plus the index), add a retention period for `AUTH_FAILURE` rows, revoke direct table privileges on `system_events` from `anon`/`authenticated`, and decide whether the global cap should become per-source (needs a hashed client key from a server route; see `docs/proposals/public-intake-contract.md`). Production use as-is is tolerable only because writes are capped and RLS blocks direct access; track it as an open P1.

## Test alignment

`lib/operations/closure.live.test.ts` now derives its expectation from `lib/operations/public-rpc-allowlist.ts`: the only anonymous function **outside** the reviewed allow-list must be `qb_auth_failure` (the open finding above). Any new anonymous function fails the suite, and the expectation tightens automatically once `qb_auth_failure` is hardened and allow-listed.
