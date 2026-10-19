import { generatePassword } from "@/lib/managed/identity";
import { admin, authenticate, isUuid, readJson, reply } from "@/lib/managed/server";

// A teacher sets a new password for a learner they manage (the child has no email to reset by). The password is shown once, here, and not stored.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const who = await authenticate(request);
  if (!who) return reply(401, { ok: false, error: "Please sign in." });
  const body = await readJson(request);
  if (!body || !isUuid(body.learnerId)) return reply(400, { ok: false, error: "Invalid request." });
  const svc = admin();
  const ok = await svc.rpc("qb_managed_learner_authorise", { p_teacher: who.user.id, p_learner: body.learnerId });
  if (ok.error || ok.data !== true) return reply(403, { ok: false, error: "You can only reset passwords for learners you manage." });
  const budget = await svc.rpc("qb_consume_budget", { p_key: `managed-reset:${who.user.id}:h`, p_limit: 60, p_seconds: 3600 });
  if (budget.error || budget.data === false) return reply(429, { ok: false, error: "Too many resets this hour. Please try again later." });
  const password = generatePassword();
  const updated = await svc.auth.admin.updateUserById(body.learnerId, { password });
  if (updated.error) return reply(502, { ok: false, error: "Could not reset the password. Please try again." });
  await svc.from("audit_logs").insert({ actor_user_id: who.user.id, action: "QB_MANAGED_PASSWORD_RESET", entity_type: "profiles", entity_id: body.learnerId, status: "pass", details: {} });
  return reply(200, { ok: true, password });
}
