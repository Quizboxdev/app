import { authenticatePartner } from "@/lib/partner/api-auth";
import { errorResponse, mapDbError, okResponse } from "@/lib/partner/errors";
import { isRef, isUuid, readJsonBody } from "@/lib/partner/http";

// GET  /api/partner/v1/seats?contract_id=...&limit=200&after=...   scope seats:read   references and link state only
// POST /api/partner/v1/seats  {contract_id, external_ref, kind?}      scope seats:write  allocates inside the approved capacity; repeating the same external_ref returns the same seat
export const runtime = "nodejs";

export async function GET(req: Request) {
  const a = await authenticatePartner(req, "seats:read");
  if (!a.ok) return a.response;
  const q = new URL(req.url).searchParams;
  const contract = q.get("contract_id"), limit = Number(q.get("limit") ?? "200"), after = q.get("after");
  if (!isUuid(contract) || !Number.isInteger(limit) || limit < 1 || limit > 500 || (after && Number.isNaN(Date.parse(after)))) return errorResponse("INVALID_REQUEST");
  const { data, error } = await a.admin.rpc("qb_partner_seat_list", { p_partner: a.auth.partnerId, p_contract: contract, p_limit: limit, p_after: after });
  if (error) return errorResponse(mapDbError(error.message));
  return okResponse({ data });
}

export async function POST(req: Request) {
  const a = await authenticatePartner(req, "seats:write");
  if (!a.ok) return a.response;
  const body = await readJsonBody(req, 4 * 1024);
  if (!body.ok) return body.response;
  const { contract_id, external_ref, kind } = body.json;
  if (!isUuid(contract_id) || !isRef(external_ref) || (kind !== undefined && kind !== "learner" && kind !== "staff")) return errorResponse("INVALID_REQUEST");
  const { data, error } = await a.admin.rpc("qb_partner_seat_allocate", { p_partner: a.auth.partnerId, p_contract: contract_id, p_external_ref: external_ref, p_user: null, p_kind: kind ?? "learner" });
  if (error) return errorResponse(mapDbError(error.message));
  return okResponse({ data }, data?.duplicate ? 200 : 201);
}
