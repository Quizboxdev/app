import { authenticatePartner } from "@/lib/partner/api-auth";
import { errorResponse, mapDbError, okResponse } from "@/lib/partner/errors";
import { isRef } from "@/lib/partner/http";

// GET /api/partner/v1/members/{external_ref}   scope members:read   seat state for one of the partner's own references: kind, status, whether the person has signed in and is licensed now.
// No name, e-mail, results or any other learner data is ever returned.
export const runtime = "nodejs";
export async function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const a = await authenticatePartner(req, "members:read");
  if (!a.ok) return a.response;
  const ref = decodeURIComponent((await ctx.params).ref);
  if (!isRef(ref)) return errorResponse("INVALID_REQUEST");
  const { data, error } = await a.admin.rpc("qb_partner_member_lookup", { p_partner: a.auth.partnerId, p_external_ref: ref });
  if (error) return errorResponse(mapDbError(error.message));
  if (!Array.isArray(data) || data.length === 0) return errorResponse("NOT_FOUND");
  return okResponse({ data });
}
