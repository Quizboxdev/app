import { admin, authenticate, isUuid, readJson, reply } from "@/lib/managed/server";
import { eraseAndScramble } from "@/lib/managed/erase";

// The owner erases a managed learner's personal data (a guardian's or school's written request, or the retention rule). The database removes
// the name, username and school and keeps non-identifying learning records; the sign-in is then scrambled so the old username can never be used
// or looked up again (lib/managed/erase.ts). Owner only.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const who = await authenticate(request);
  if (!who) return reply(401, { ok: false, error: "Please sign in." });
  const body = await readJson(request);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!body || !isUuid(body.learnerId) || reason.length < 5 || reason.length > 200) return reply(400, { ok: false, error: "Say who asked and why (at least 5 characters)." });
  const ctx = await who.client.rpc("qb_sme_context");
  if (ctx.error || !(ctx.data as { super_admin?: boolean } | null)?.super_admin) return reply(403, { ok: false, error: "Only the owner can erase a learner's data." });
  const result = await eraseAndScramble(admin(), body.learnerId, reason);
  if (!result.ok) {
    if (result.code === "SCRAMBLE_FAILED") return reply(502, { ok: false, error: "Personal data was erased but the sign-in could not be scrambled. Try again: it is safe to repeat." });
    return reply(result.code === "NOT_FOUND" ? 404 : 400, { ok: false, error: "That learner could not be found among managed accounts." });
  }
  return reply(200, { ok: true, already: result.already });
}
