import { randomBytes } from "node:crypto";
import { admin, authenticate, isUuid, readJson, reply } from "@/lib/managed/server";

// A parent resets a child's access: the old password stops working at once and the parent gets a fresh single-use link. The database confirms the parent may manage this child.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const who = await authenticate(request);
  if (!who) return reply(401, { ok: false, error: "Please sign in." });
  const body = await readJson(request);
  if (!body || !isUuid(body.studentId)) return reply(400, { ok: false, error: "Invalid request." });
  const allowed = await who.client.rpc("qb_family_can", { p_student: body.studentId, p_perm: "manage_access" });
  if (allowed.error || allowed.data !== true) return reply(403, { ok: false, error: "You can only reset access for your own children." });
  const svc = admin();
  const budget = await svc.rpc("qb_consume_budget", { p_key: `family-reset:${who.user.id}:h`, p_limit: 20, p_seconds: 3600 });
  if (budget.error || budget.data === false) return reply(429, { ok: false, error: "Too many resets this hour. Please try again later." });
  const updated = await svc.auth.admin.updateUserById(body.studentId, { password: randomBytes(24).toString("base64url") });
  if (updated.error) return reply(502, { ok: false, error: "Could not reset access. Please try again." });
  const invite = await who.client.rpc("qb_family_invite_issue", { p_student: body.studentId });
  if (invite.error) return reply(502, { ok: false, error: "Access was reset but the new link could not be made. Press Resend invitation." });
  await svc.from("audit_logs").insert({ actor_user_id: who.user.id, action: "family.access_reset", entity_type: "profiles", entity_id: body.studentId, status: "pass", details: {} });
  return reply(200, { ok: true, token: invite.data.token, expiresAt: invite.data.expires_at });
}
