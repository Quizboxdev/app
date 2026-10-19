import { admin, authenticate, isUuid, readJson, reply } from "@/lib/managed/server";

// A teacher ends a managed learner's account (the child leaves the school or the guardian withdraws consent). The database marks the account and the
// class seat inactive and keeps the history for the retention period; this route also blocks sign-in so the credentials stop working at once.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const who = await authenticate(request);
  if (!who) return reply(401, { ok: false, error: "Please sign in." });
  const body = await readJson(request);
  if (!body || !isUuid(body.learnerId)) return reply(400, { ok: false, error: "Invalid request." });
  const archived = await who.client.rpc("qb_managed_learner_archive", { p_learner: body.learnerId });      // the database checks the teacher manages this learner
  if (archived.error) return reply(403, { ok: false, error: "You can only end accounts for learners you manage." });
  const banned = await admin().auth.admin.updateUserById(body.learnerId, { ban_duration: "876000h" });
  if (banned.error) return reply(502, { ok: false, error: "The account was ended but sign-in could not be blocked. Please contact support." });
  return reply(200, { ok: true });
}
