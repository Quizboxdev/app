import { authenticatePartner } from "@/lib/partner/api-auth";
import { errorResponse, mapDbError, okResponse } from "@/lib/partner/errors";
import { isRef } from "@/lib/partner/http";

// DELETE /api/partner/v1/seats/{external_ref}?reason=...   scope seats:write   revokes the seat; the person's QuizBox account and learning history are kept. Repeating it is harmless.
export const runtime = "nodejs";
export async function DELETE(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const a = await authenticatePartner(req, "seats:write");
  if (!a.ok) return a.response;
  const ref = decodeURIComponent((await ctx.params).ref);
  const reason = new URL(req.url).searchParams.get("reason");
  if (!isRef(ref) || (reason && reason.length > 200)) return errorResponse("INVALID_REQUEST");
  const { data, error } = await a.admin.rpc("qb_partner_seat_revoke", { p_partner: a.auth.partnerId, p_external_ref: ref, p_reason: reason });
  if (error) return errorResponse(mapDbError(error.message));
  return okResponse({ data });
}
