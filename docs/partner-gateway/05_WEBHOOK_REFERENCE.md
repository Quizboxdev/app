# Partner events (inbound webhooks)

Send events to `POST https://www.quizbox.io/api/partner/v1/events` when something changes on your side (a student leaves, a record is corrected). Events can only **allocate or revoke seats inside the capacity QuizBox approved** or update the billing reference text. They can never raise capacity, change dates, or activate a contract.

## Signing
QuizBox staff create an **event signing secret** for you (Admin > Partner Integrations > Keys and events > Create secret). It is shown once.

Headers:
- `Content-Type: application/json`
- `X-QuizBox-Partner: <your partner id (uuid)>`
- `X-QuizBox-Signature: t=<unix seconds>,v1=<hex>` where `v1 = HMAC-SHA256(secret, "<t>." + <raw request body>)`

Sign the **exact bytes** you send. QuizBox rejects a timestamp more than **5 minutes** from its clock (so keep your clock correct), a signature that does not match, and more than four `v1` values. During a secret rotation the old secret stays valid for 24 hours; you may send both `v1` values.

## Body
```json
{ "id": "evt_01H...", "type": "partner.seat.allocated", "data": { "contract_id": "<uuid>", "external_ref": "student-2041", "kind": "learner" } }
```
`id` must be unique per event (up to 200 characters). Resending the same `id` with the same body is safe and answers `{ "status": "duplicate" }`. Reusing an `id` with a different body is refused (`EVENT_REPLAY_MISMATCH`).

| `type` | `data` | Effect |
|---|---|---|
| `partner.seat.allocated` | `contract_id`, `external_ref`, optional `kind` | Allocates (idempotent, inside capacity) |
| `partner.seat.revoked` | `external_ref`, optional `reason` | Revokes the seat |
| `partner.member.updated` | `external_ref`, `active` (boolean) | `active:false` revokes the seat; `active:true` is ignored (allocate a seat instead) |
| `partner.contract.reference_updated` | `contract_id`, `billing_reference` | Changes the invoice reference text and marks the contract "unreconciled" for staff to check |

## Responses and retries
`200 {"status":"processed"|"duplicate"|"ignored","event_id":...}`. Rule refusals return their error code with the 4xx status (for example `SEAT_CAPACITY_EXCEEDED`) and are recorded. Unexpected failures return `500 EVENT_PROCESSING_FAILED`; retry with the same `id` and body. After five failed attempts QuizBox marks the event a **dead letter**; staff see it under Delivery log and can allow a retry. Do not send personal learner data in events: only your own reference ids.

## Example (Node 18+)
```js
import { createHmac } from "node:crypto";
const body = JSON.stringify({ id: "evt_1", type: "partner.seat.revoked", data: { external_ref: "student-2041" } });
const t = Math.floor(Date.now() / 1000);
const v1 = createHmac("sha256", process.env.QUIZBOX_EVENT_SECRET).update(`${t}.${body}`).digest("hex");
await fetch("https://www.quizbox.io/api/partner/v1/events", { method: "POST", body,
  headers: { "content-type": "application/json", "x-quizbox-partner": process.env.QUIZBOX_PARTNER_ID, "x-quizbox-signature": `t=${t},v1=${v1}` } });
```
