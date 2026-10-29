# Security and privacy review (Phase 2)

Method: static review of source and migrations, scripted scans, live read-only header checks on the public site, existing database test suites. No attacks, scans of production, credential guessing or load were performed.

## Verified controls (PASS, with evidence)

| Control | Evidence | Status |
|---|---|---|
| No secrets in tracked source | Pattern scan for live/test keys, JWTs, DB URLs, Resend/AWS keys over tracked files; only fake `sk_test_secret` in a test. `.gitignore` excludes `.env*` except examples. | PASS |
| Row-level security on every public table | 98 tables; every one is enabled either explicitly or in the dynamic loops of 6 migrations (core foundation, market/SME, enforcement, sponsor, internal schemas). Database test `core-platform.test.ts` asserts RLS and select-only grants on the new tables. Live DB state: UNVERIFIED. | PASS (static) |
| Definer functions pin `search_path` | Scan of all 276 functions: 0 `SECURITY DEFINER` definitions without `set search_path`. | PASS (static) |
| Anonymous access is minimal | Only 4 functions granted to `anon` (`qb_auth_failure`, `qb_public_platform_stats`, `qb_signup_markets`, one generic grant loop); no table grants to `anon`; default function privileges revoked from PUBLIC. | PASS (static) |
| No permissive policies | No `using (true)` or `with check (true)` in any migration. | PASS (static) |
| Payment integrity | Price computed server-side from Coins x unit price; amount from the database must equal the route's price; Paystack webhook verified by HMAC-SHA512 with `timingSafeEqual` plus server re-query; settlement idempotent; minors blocked from paying. | PASS (code); end-to-end NOT RUN |
| Cron and ops endpoints are closed by default | `/api/cron/*` need `CRON_SECRET` (16+ chars, constant-time compare); generation endpoint compares SHA-256 digests; webhook 404s unknown providers and caps the body at 64 KB. | PASS (code) |
| Teacher-managed child accounts | Routes require an authenticated teacher, authorise the teacher-learner pair in SQL, rate-limit with `qb_consume_budget` (200 accounts/hour, 60 resets/hour), generate passwords server-side shown once. | PASS (code) |
| SSRF on curriculum fetch | Admin-only; official-host allow-list from SQL, redirects handled manually and re-checked, size-capped, PDFs only. | PASS (code) |
| XSS | Only two `dangerouslySetInnerHTML` uses: a constant redirect script and KaTeX output (`throwOnError:false`, default `trust:false`). No `eval`. | PASS (code) |
| Transport and headers (live) | HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP present on `www`; apex redirects 308 to `www`. | PASS |

## Findings

See `audit-findings.csv` for the full register. Security-relevant items:

* **QB-AUD-004 (P2)** CSP is Report-Only; it does not block anything yet.
* **QB-AUD-006 (P2)** Page authorization is client-side; data safety depends entirely on RLS and RPC checks (which look sound statically). Add a server-side session check for defence in depth.
* **QB-AUD-007 (P3)** View/share counter endpoint trusts a forgeable `Origin` header and has no rate limit.
* **QB-AUD-008 (P3)** Ops secret compared with `!==`.
* **QB-AUD-014 (P3)** Document parsers run on user uploads with only a compressed-size cap.
* **QB-AUD-009 (P3)** Six high npm advisories, all dev-only.
* **QB-AUD-002 (P1, availability)** Silent server failures hide a production problem (see functional report).

No P0 findings. No confirmed data exposure.

## Not performed (BLOCKED / NOT RUN)

* Broken object-level authorization probes across two real accounts (needs Preview accounts).
* Brute-force and rate-limit behaviour of Supabase Auth (provider-managed; policy to be confirmed in the dashboard).
* Cookie flags and CORS of Supabase auth cookies (set by `@supabase/ssr`; not inspected live because no session was available).
* Student and minor protections were reviewed in code and database tests (managed learners, consent, erasure cron) but not exercised.
* Storage bucket policies for `curriculum-sources` and media were not read in full.
