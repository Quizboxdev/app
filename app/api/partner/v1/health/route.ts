import { authenticatePartner } from "@/lib/partner/api-auth";
import { errorResponse, mapDbError, okResponse } from "@/lib/partner/errors";

// GET /api/partner/v1/health   scope health:read   confirms the key works and shows recent event counts and the SSO state.
export const runtime = "nodejs";
export async function GET(req: Request) {
  const a = await authenticatePartner(req, "health:read");
  if (!a.ok) return a.response;
  const { data, error } = await a.admin.rpc("qb_partner_health", { p_partner: a.auth.partnerId });
  if (error) return errorResponse(mapDbError(error.message));
  return okResponse({ data });
}
