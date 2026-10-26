# Partner Access Gateway (QPAG): current state, architecture and plan

Branch `feature/partner-access-gateway` (from `main` 5c3e797). Flag `flags.partner_access_gateway_v1`, default **off**. Nothing here is applied to any database or deployed.

## 1. Current state (reconnaissance, verified in the repository)

| Question | Finding | Evidence |
|---|---|---|
| Where is paid access decided? | One function, `qb_has_subscription(uuid)`, defined once. It is called by `qb_free_allowance_exhausted` and `qb_my_access`. Nothing else decides "subscribed" | `20261018100000_access_gate_standalone.sql:48`; only definition; callers in `20261018`, `20261027` |
| Where is it enforced? | Server side in SQL: `qb_start_quick_practice`, study mode (`20261019140000`), challenge start/join (`qb_challenge_allowance_blocked`, `20261027`), seat caps (`20261041100000_challenge_seats.sql`). The browser only reads `qb_my_access` to show messages | migrations above; `lib/api/access.ts` |
| Is `qb_my_access` the only place? | No. It reports; the gates are in the start-practice, study and challenge functions, all of which call `qb_free_allowance_exhausted` -> `qb_has_subscription` | grep of all callers |
| Subscriptions | `learner_subscriptions` (status, valid_from, valid_until, source), written by the Paystack settlement path and by staff grants | `20261018`, `20261019110000`, `lib/payments/settlement.ts` |
| Entitlements | `access_entitlements` (core platform) records spendable entitlements; separate from the learner gate | `20261007100000` |
| Organisations | `institutions`, `institution_memberships`, classes and class memberships; school-managed minors have `student_profiles.managed_by` | `20260926180522`, core migrations |
| Roles and staff checks | `quizbox_core.is_staff(roles)`, owner profile, `user_capabilities`; staff RPCs are SECURITY DEFINER with an explicit staff check | core foundation; affiliate migration pattern |
| Audit | `quizbox_core.audit(action, entity_type, entity, details)` writes `audit_logs` | core foundation |
| Flags | `platform_settings` keys `flags.*`, read with `quizbox_core.flag()` | affiliate release |
| Auth | Supabase Auth with email links and `/auth/callback`; middleware protects `(app)` routes | `lib/auth.ts`, `middleware.ts`, `lib/auth-callback.test.ts` |
| SSO today | None. Supabase Auth is used for email/password and magic links only | repo search |

**Consequence for the design:** one change point. Making `qb_has_subscription` also answer "has an active partner seat" extends every existing gate at once, with no change to practice, study, assignments or challenge functions, and with no way for a partner key to bypass anything because the key never reaches the user's session.

## 2. Architecture

```
Partner system ──(HTTPS, scoped API key)──► /api/partner/v1/*  ──► qb_partner_* (service role, bound to the authenticated partner id)
Partner system ──(signed event, HMAC)────► /api/partner/v1/events ─► qb_partner_event_begin (idempotency) ─► qb_partner_seat_* / reference_update
Partner users ──(OIDC / SAML via partner IdP)─► /partner/[slug]/login ─► server verifies token ─► qb_partner_sso_link ─► normal Supabase session
QuizBox staff ─► /admin/partners ─► qb_admin_partner_* (super admin only, audited)
Any learner action ─► existing functions ─► qb_free_allowance_exhausted ─► qb_has_subscription ─► subscription OR active partner seat
```

Trust rules built into the database layer (phase 1, delivered and tested):
1. **QuizBox approves money, not the partner.** A contract becomes ACTIVE only through `qb_admin_partner_contract_approve`: verified partner, external billing reference, written note, a second approver (owner excepted, audited). A partner event can change the billing reference text only; capacity, dates and status never change from a partner call.
2. **Seats are atomic and idempotent.** The contract row is locked while counting; the same external reference returns the same seat; overflow raises `QB_PARTNER_SEAT_CAPACITY`.
3. **Access is derived, never stored.** Licensed access = flag on AND partner verified AND contract ACTIVE AND today inside the dates AND seat active. Expiry removes access on the date itself; accounts, seats and learning history stay.
4. **Partner isolation.** Every partner function takes the authenticated partner id and filters on it; a different partner's contract or seats are "not found".
5. **No secrets at rest in readable form.** API keys: SHA-256 hash only, shown once, 24-hour overlap on rotation. Webhook secrets: ciphertext produced by the application (key in server environment), opaque to the database. Event logs hold a payload hash, never the payload. Audit details never contain secrets (tested).
6. **Minors.** A free-standing minor cannot be seated; a school-managed minor can (the school holds the consent).
7. **Closed tables.** Row-level security on, no grants to `anon` or `authenticated`; staff and partners reach data only through functions.

## 3. Phases
| Phase | Content | Status |
|---|---|---|
| 1 Database foundation | Tables, staff and partner functions, entitlement hook, flag, rollback | Done |
| 2 Server layer | `/api/partner/v1` (licences, seats, members, health, signed events), key authentication with scopes, rate limits, raw-body HMAC with a 5 minute window, idempotent events, dead letters, error codes | Done, tested |
| 3 OIDC sign-in | Authorization code + PKCE, state and nonce cookie, full ID token verification, account matching, learner provisioning, hand-over to a single-use QuizBox sign-in link | Done, tested with generated keys; real provider test needs Preview |
| 4 Admin and entry page | `/admin/partners` (directory, contracts, seats, sign-in wizard, keys and events, delivery log, audit), navigation entry, `/partner/<name>` entry page | Done; browser test needs a Preview super-admin |
| 5 Docs and evidence | Files 03 to 07 in this folder, examples, parallel-seat proof script | Done; Preview runs are the owner's steps in file 07 |

## 4. Not decided here (owner decisions)
- Package catalogue and prices (external; QuizBox only records the reference).
- Decided by the owner: staff (teacher) seats are offered. They are licence records only and never change a QuizBox role.
- Grade and curriculum scope are stored on the contract but not yet enforced against a learner's grade (needs the grade source of truth; phase 3).
- Decided by the owner: OpenID Connect only; SAML is not supported in this release.
- Data processing agreement and partner terms (legal).
