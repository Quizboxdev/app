import { authenticatePartner } from "@/lib/partner/api-auth";
import { errorResponse, mapDbError, okResponse } from "@/lib/partner/errors";

// GET /api/partner/v1/licences: the partner's contracts with capacity and state. Scope licence:read. Only this partner's records are ever returned.
export const runtime = "nodejs";
export async function GET(req: Request) {
  const a = await authenticatePartner(req, "licence:read");
  if (!a.ok) return a.response;
  const { data, error } = await a.admin.rpc("qb_partner_licence_status", { p_partner: a.auth.partnerId });
  if (error) return errorResponse(mapDbError(error.message));
  return okResponse({ data });
}
