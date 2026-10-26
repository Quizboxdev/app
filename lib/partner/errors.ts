import { NextResponse } from "next/server";

// Documented, stable error codes for the Partner API (docs/partner-gateway/04_PARTNER_API_REFERENCE.md). The message never reveals whether a key, a partner or a signature was the problem.
export const PARTNER_ERRORS = {
  AUTH_INVALID: [401, "The credentials are missing, invalid, expired or revoked."],
  SCOPE_FORBIDDEN: [403, "This credential does not have the scope this call needs."],
  RATE_LIMITED: [429, "Too many requests. Slow down and retry after the delay."],
  FEATURE_DISABLED: [503, "The partner gateway is not available."],
  NOT_FOUND: [404, "The record was not found for this partner."],
  INVALID_REQUEST: [400, "The request is malformed or a field is invalid."],
  PAYLOAD_TOO_LARGE: [413, "The request body is too large."],
  UNSUPPORTED_MEDIA_TYPE: [415, "Send application/json."],
  LICENCE_NOT_ACTIVE: [409, "The contract is not active (not approved, suspended, expired or cancelled)."],
  SEAT_CAPACITY_EXCEEDED: [409, "All seats in the contract are in use."],
  SEAT_KIND_CONFLICT: [409, "The reference already holds a seat of a different kind."],
  SEAT_KIND_NOT_IN_CONTRACT: [422, "The contract does not include this kind of seat."],
  MINOR_CONSENT_REQUIRED: [422, "A minor can be seated only when a school manages the account."],
  STAFF_SEAT_ADULT_ONLY: [422, "Staff seats are for adults."],
  EVENT_UNSUPPORTED: [422, "This event type is not supported."],
  EVENT_REPLAY_MISMATCH: [409, "This event id was already used with a different body."],
  SIGNATURE_INVALID: [401, "The signature is missing, malformed, stale or does not match."],
  EVENT_PROCESSING_FAILED: [500, "The event could not be processed. It will be retried."],
  INTERNAL: [500, "Something went wrong on our side."],
} as const;
export type PartnerErrorCode = keyof typeof PARTNER_ERRORS;

export function errorResponse(code: PartnerErrorCode, retryAfterSeconds?: number): NextResponse {
  const [status, message] = PARTNER_ERRORS[code];
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (retryAfterSeconds) headers["Retry-After"] = String(retryAfterSeconds);
  return NextResponse.json({ error: { code, message } }, { status, headers });
}
export const okResponse = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Database messages -> public codes.
const DB_MAP: [RegExp, PartnerErrorCode][] = [
  [/QB_FEATURE_DISABLED/, "FEATURE_DISABLED"], [/QB_PARTNER_AUTH_INVALID/, "AUTH_INVALID"], [/QB_PARTNER_NOT_FOUND/, "NOT_FOUND"], [/QB_PARTNER_INVALID_INPUT/, "INVALID_REQUEST"],
  [/QB_PARTNER_LICENCE_NOT_ACTIVE/, "LICENCE_NOT_ACTIVE"], [/QB_PARTNER_SEAT_CAPACITY/, "SEAT_CAPACITY_EXCEEDED"], [/QB_PARTNER_SEAT_KIND_CONFLICT/, "SEAT_KIND_CONFLICT"],
  [/QB_PARTNER_(STAFF|LEARNER)_SEATS_NOT_IN_CONTRACT/, "SEAT_KIND_NOT_IN_CONTRACT"], [/QB_PARTNER_MINOR_CONSENT_REQUIRED/, "MINOR_CONSENT_REQUIRED"], [/QB_PARTNER_STAFF_SEAT_ADULT_ONLY/, "STAFF_SEAT_ADULT_ONLY"],
  [/QB_PARTNER_EVENT_UNSUPPORTED/, "EVENT_UNSUPPORTED"], [/QB_PARTNER_EVENT_REPLAY_MISMATCH/, "EVENT_REPLAY_MISMATCH"],
];
export function mapDbError(message: string | undefined): PartnerErrorCode {
  for (const [re, code] of DB_MAP) if (re.test(message ?? "")) return code;
  return "INTERNAL";
}
