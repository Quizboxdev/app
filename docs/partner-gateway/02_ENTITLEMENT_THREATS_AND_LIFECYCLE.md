# QPAG: entitlement matrix, threat model, lifecycles (phase 1)

## Entitlement decision matrix (what `qb_has_subscription` answers)
| Individual subscription | Licence seat live* | Flag on | Result |
|---|---|---|---|
| active | any | any | Subscribed |
| none | yes | yes | Subscribed (licensed) |
| none | yes | **no** | Not subscribed (free allowance applies) |
| none | no (expired, suspended, cancelled, partner not verified, seat revoked) | any | Not subscribed; free allowance applies; account and history kept |
| expired | yes | yes | Subscribed (licensed) |
\* live = contract ACTIVE, today within start and expiry, partner VERIFIED, seat ACTIVE, contract includes `practice`.
Unfinished practice already started continues (the gate is checked at start). A person with both a subscription and a licence keeps access when either one ends. No checkout is offered to a person who is already subscribed (existing behaviour of the gate).

## Threat model
| Threat | Control | Tested |
|---|---|---|
| Partner claims payment to obtain seats | Only staff approval activates a contract; billing reference and note required; partner events cannot change capacity, dates or status | yes |
| Overselling seats by parallel calls | Contract row locked during count; unique active reference | sequential overflow yes; true parallel to be proven on Preview |
| Retry creates two seats | Same reference returns the same seat | yes |
| Stolen API key | Hash only at rest, short life (max 365 days, default 90), scopes, revoke, 24h-overlap rotation, partner suspension kills keys | yes |
| Key reused across partners | Every function filters on the authenticated partner id | yes |
| Replayed or altered webhook | Event id unique; payload hash must match; unsupported types refused; (phase 2 adds HMAC, timestamp window, size limit) | DB part yes |
| Forged sign-in | Phase 3 validates issuer, audience, signature, expiry, state, nonce, PKCE; DB refuses an unconfigured issuer and an issuer + subject already bound to another account | DB part yes |
| Account takeover by email match | Linking uses issuer + stable subject, never email; conflict is an error | yes |
| Privilege escalation through partner claims | Only `learner` role can be configured; no staff role is ever granted from a claim | yes (check constraint) |
| Minor exposed without consent | Free-standing minors cannot be seated; school-managed minors can | yes |
| Cross-organisation exposure | Partner functions return references and link state only (no names, emails, results) | yes |
| Secrets in logs | Audit details checked for secrets; events store a hash only | yes |
| Browser reading partner tables | RLS on, no grants to browser roles | yes |
| Service-role key reaching partners | Partners never receive it; they use their own scoped key against QuizBox routes | design |

## Contract lifecycle
`DRAFT` -> (submit) `PENDING_APPROVAL` -> (approve) `ACTIVE` <-> (suspend / reinstate) `SUSPENDED`; `ACTIVE`/`SUSPENDED` -> `EXPIRED` (daily sweep, access already ended on the date); any open state -> `CANCELLED`. Editing is allowed only in DRAFT/PENDING; a live contract is changed by a noted, audited amendment that cannot drop below seats in use.

## Member lifecycle
Seat allocated (reference, optional account) -> person signs in through the partner (identity link: issuer + subject -> account; seat linked to the account) -> licensed access while the contract is live -> seat revoked or contract ends -> access stops, account and history remain, identity link revoked on revoke.

## Rollback
`supabase/rollback/partner_access_gateway.sql`: restores the earlier `qb_has_subscription`, removes all partner functions, switches the flag off, keeps every record. Nothing needs the rollback while the flag is off.
