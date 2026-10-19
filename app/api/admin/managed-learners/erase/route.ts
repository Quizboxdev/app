import { randomBytes } from "node:crypto";
import { admin, authenticate, isUuid, readJson, reply } from "@/lib/managed/server";

// The owner erases a managed learner's personal data (a guardian's or school's written request, or the 12-month retention rule). The database removes
// the name, username and school and keeps non-identifying learning records; this route then scrambles the sign-in (a new unreachable address, a random
// password nobody sees, sign-in blocked for good) so the old username can never be used or looked up again. Owner only.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const who = await authenticate(request);
  if (!who) return reply(401, { ok: false, error: "Please sign in." });
  const body = await readJson(request);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!body || !isUuid(body.learnerId) || reason.length < 5 || reason.length > 200) return reply(400, { ok: false, error: "Say who asked and why (at least 5 characters)." });
  const ctx = await who.client.rpc("qb_sme_context");
  if (ctx.error || !(ctx.data as { super_admin?: boolean } | null)?.super_admin) return reply(403, { ok: false, error: "Only the owner can erase a learner's data." });
  const svc = admin();
  const erased = await svc.rpc("qb_managed_learner_erase", { p_learner: body.learnerId, p_reason: reason });
  if (erased.error) return reply(erased.error.message.includes("QB_MANAGED_LEARNER_NOT_FOUND") ? 404 : 400, { ok: false, error: "That learner could not be found among managed accounts." });
  const out = erased.data as { login_email?: string; already?: boolean };
  if (!out.already && out.login_email) {
    const scrambled = await svc.auth.admin.updateUserById(body.learnerId, { email: out.login_email, password: randomBytes(24).toString("base64url"), ban_duration: "876000h", user_metadata: { full_name: "Former learner", managed: true } });
    if (scrambled.error) return reply(502, { ok: false, error: "Personal data was erased but the sign-in could not be scrambled. Try again: it is safe to repeat." });
  }
  return reply(200, { ok: true, already: Boolean(out.already) });
}
