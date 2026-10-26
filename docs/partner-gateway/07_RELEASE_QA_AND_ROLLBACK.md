# QPAG: release, QA evidence and rollback

Nothing here is applied or deployed. The feature is off (`flags.partner_access_gateway_v1` = false) until the owner switches it on in Admin > Partner Integrations.

## Before anything
1. Generate the server key once and add it to Vercel (Preview first): `PARTNER_SECRETS_KEY` = 32 random bytes, base64. PowerShell: `[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])` (or `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Never commit it. Losing it means stored webhook and client secrets must be re-entered.
2. Optional: `PARTNER_SSO_ORIGIN` (default `https://www.quizbox.io`). It must equal the origin registered as the redirect address with the partner. Preview sign-in tests need a Preview origin registered with a TEST identity provider client.
3. Supabase Auth: the existing `/auth/callback` must already be an allowed redirect (it is, for e-mail links).

## Apply order (Preview, then Production), using the paste parts
`docs/release/sql-parts/20261049100000/` (7 parts) then `docs/release/sql-parts/20261049200000/` (parts). Check with the fingerprint A and B after each. Rollback: `supabase/rollback/partner_gateway_server_layer.sql` first, then `supabase/rollback/partner_access_gateway.sql` (records are kept).

## Preview acceptance (the owner runs these)
1. Admin: add a test partner "PROOF School", verify it, create a contract with package `proof-test`, 20 seats, an invoice reference; a second super admin approves it.
2. Switch the gateway on in Preview only.
3. Parallel seats: `$env:PROOF_SUPABASE_URL`, `PROOF_SERVICE_KEY`, `PROOF_PARTNER_ID`, `PROOF_CONTRACT_ID`, then `npx tsx scripts/partner/prove-parallel-seats.ts --preview`. It must print PASSED (60 simultaneous people never exceed 20; 25 simultaneous calls for one person create one seat).
4. Issue a key; call `GET /licences`, allocate a seat with `POST /seats`, repeat it (expect 200 duplicate), over-allocate (expect `SEAT_CAPACITY_EXCEEDED`).
5. Create the event secret; send a signed event with `examples/send-event.mjs`; send it again (duplicate); send it with a wrong secret (401).
6. Sign-in: configure a TEST OIDC client (Google Workspace test app, Keycloak or Okta developer), allocate a seat whose `external_ref` is that test user's `sub`, sign in at `/partner/<name>`, confirm the learner can start practice without a subscription; revoke the seat and confirm practice falls back to the free allowance and the account and history remain.

## QA evidence collected in the build (automated, local)
| Area | Evidence |
|---|---|
| Database rules | `lib/core/partner-access-gateway-sql.test.ts`: 23 tests (closed tables, staff-only functions, flag off = unchanged access, contract approval gates, overflow, idempotent retry, partner isolation, expiry/suspension/cancellation/partner suspension, another entitlement keeps working, minors, staff seats, credentials, event idempotency/replay/dead letters, secret rotation, SSO linking, account matching, public-domain and administrator protection, rate buckets, audit without secrets, rollback) |
| Signatures and secrets | `lib/partner/crypto.test.ts`: valid, stale, future, tampered, wrong secret, rotation, malformed headers, encryption tamper, cookie forgery |
| Token verification | `lib/partner/oidc.test.ts`: RS256 and ES256 valid; tampered; wrong key; alg none; HMAC key confusion; wrong key type; unknown kid; wrong issuer; audience; expiry; not-before; future issue time; nonce missing or wrong; empty subject; oversize; PKCE; code exchange; JWKS cache and limits |
| Routes | `lib/partner/routes.test.ts`: no/bad/unknown key; scope; rate limit; fail-closed limiter; partner id always from the key; seat validation; 200 vs 201; capacity 409; body limits; signed events (valid, duplicate, replay mismatch, stale, wrong, unreadable secret, unsupported type, bad schema); sign-in start/callback (state mismatch, tampered/expired cookie, forged tokens, revoked, unknown, conflict, minor, provisioning rules, no role from claims) |
| Build | `tsc --noEmit`, `eslint`, full `vitest run`, `next build` (see the pull request for the final run) |

## Not proven yet (stated plainly)
True parallel seat allocation and the real sign-in against an external identity provider need Preview (steps 3 and 6). Browser-level E2E of `/admin/partners` needs a Preview super-admin account. Grade and curriculum scope are stored on contracts but not yet enforced against a learner's grade. SAML is not supported.

## Rollback
Switch the flag off (immediate effect: licences grant nothing; keys, events and sign-in stop). Then, if required, run the two rollback scripts. Accounts, learning history, seats and contracts are never deleted.
