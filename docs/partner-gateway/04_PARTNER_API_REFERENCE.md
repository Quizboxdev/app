# QuizBox Partner API v1

Base URL: `https://www.quizbox.io/api/partner/v1`. JSON only. Server-to-server: never call it from a browser or a mobile app.

## Authentication
`Authorization: Bearer qbpk_<64 hex>`. QuizBox staff issue a key for your verified organisation in **Admin > Partner Integrations > Keys and events**. The key is shown once; QuizBox stores only a hash. Each key has **scopes**, an expiry (default 90 days, maximum 365), and can be rotated (the old key keeps working for 24 hours) or revoked. Keep it in a secret store, never in source control. A key works only on your own organisation's records.

| Scope | Allows |
|---|---|
| `licence:read` | GET /licences |
| `seats:read` | GET /seats |
| `seats:write` | POST /seats, DELETE /seats/{ref} |
| `members:read` | GET /members/{ref} |
| `health:read` | GET /health |

## Endpoints
| Method and path | Purpose |
|---|---|
| `GET /licences` | Your contracts: package, status, `active_now`, dates, `max_seats`, `allocated`, `remaining`, reconciliation state |
| `GET /seats?contract_id=<uuid>&limit=200&after=<iso time>` | Seat references of one contract (no names or e-mails). `limit` 1 to 500 |
| `POST /seats` body `{ "contract_id": "<uuid>", "external_ref": "<your id for the person>", "kind": "learner" or "staff" }` | Allocate a seat inside the approved capacity. **Idempotent**: the same `external_ref` returns the same seat (HTTP 200, `duplicate: true`); a new seat is HTTP 201 |
| `DELETE /seats/{external_ref}?reason=...` | Revoke the seat. The person's QuizBox account and learning history are kept. Repeating is harmless (`revoked: 0`) |
| `GET /members/{external_ref}` | Seat state of one of your references: `kind`, `status`, `linked` (has signed in), `licensed_now` |
| `GET /health` | Confirms the key works; recent event counts and sign-in state |

You cannot create or enlarge a contract through the API. Capacity and dates are set only by QuizBox staff after your invoice is verified.

`external_ref` is your own stable identifier for the person (for example your student number or the OpenID `sub`). It must match the `sub` (or the optional `qb_member_ref` claim) in the ID token your identity provider issues, because that is how a sign-in finds its seat.

## Seats
`kind: "learner"` gives learner practice access. `kind: "staff"` (only if your contract includes staff seats) records a teacher or administrator licence; **it never changes the person's role in QuizBox**, which stays with QuizBox staff and school administrators. Staff seats share the same `max_seats`. A learner under 18 can be seated only when a school manages the account.

## Errors
Every error: `{ "error": { "code": "...", "message": "..." } }`. Codes are stable.

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `INVALID_REQUEST` | Malformed JSON or an invalid field |
| 401 | `AUTH_INVALID` | Key missing, wrong, expired or revoked (never says which) |
| 401 | `SIGNATURE_INVALID` | (events) signature missing, malformed, stale or wrong |
| 403 | `SCOPE_FORBIDDEN` | The key lacks the scope |
| 404 | `NOT_FOUND` | Not found for your organisation |
| 409 | `LICENCE_NOT_ACTIVE` | Contract not approved, suspended, expired or cancelled |
| 409 | `SEAT_CAPACITY_EXCEEDED` | No seats left |
| 409 | `SEAT_KIND_CONFLICT` | The reference already holds a different kind of seat |
| 409 | `EVENT_REPLAY_MISMATCH` | An event id was reused with a different body |
| 413 / 415 | `PAYLOAD_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` | Body over the limit / not JSON |
| 422 | `SEAT_KIND_NOT_IN_CONTRACT`, `MINOR_CONSENT_REQUIRED`, `STAFF_SEAT_ADULT_ONLY`, `EVENT_UNSUPPORTED` | Rule refusals |
| 429 | `RATE_LIMITED` | Slow down; see `Retry-After` |
| 500 / 503 | `INTERNAL`, `EVENT_PROCESSING_FAILED`, `FEATURE_DISABLED` | Retry later with backoff |

## Limits
120 requests per minute per organisation and 60 authentication attempts per minute per caller address. Request bodies up to 4 KB (events 16 KB). Retry `429` and `5xx` with exponential backoff and jitter; `POST /seats` is safe to retry.

## Example
```bash
curl -s https://www.quizbox.io/api/partner/v1/licences -H "Authorization: Bearer $QUIZBOX_PARTNER_KEY"
curl -s -X POST https://www.quizbox.io/api/partner/v1/seats -H "Authorization: Bearer $QUIZBOX_PARTNER_KEY" \
  -H "Content-Type: application/json" -d '{"contract_id":"<uuid>","external_ref":"student-2041"}'
```
Working Node and Python code is in `examples/`.
