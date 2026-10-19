import { NAME_PATTERN, MANAGED_EMAIL_DOMAIN, generatePassword, generateUsername } from "@/lib/managed/identity";
import { admin, authenticate, isUuid, readJson, reply } from "@/lib/managed/server";

// A teacher creates sign-ins for the learners of a class they own (children under 13 do not register themselves). Only the teacher's own session is
// trusted to say who they are; the database then checks that they own the class, and the stored consent confirmation is required. Passwords are returned
// once in this response and never stored. Everything is limited to 200 accounts an hour per teacher.
export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_PER_REQUEST = 60;

export async function POST(request: Request) {
  const who = await authenticate(request);
  if (!who) return reply(401, { ok: false, error: "Please sign in." });
  const body = await readJson(request);
  if (!body) return reply(400, { ok: false, error: "Invalid request." });
  const classId = body.classId, names = body.names, consentRef = typeof body.consentReference === "string" ? body.consentReference.trim() : "";
  if (!isUuid(classId) || !Array.isArray(names) || names.length < 1 || names.length > MAX_PER_REQUEST || names.some((n) => typeof n !== "string" || !NAME_PATTERN.test(n.trim())))
    return reply(400, { ok: false, error: `Enter 1 to ${MAX_PER_REQUEST} first names (letters, spaces, hyphens and apostrophes only).` });
  if (body.consentConfirmed !== true || consentRef.length < 5 || consentRef.length > 120)
    return reply(400, { ok: false, error: "Confirm that the school holds each guardian's consent and say where it is recorded (at least 5 characters)." });

  const context = await who.client.rpc("qb_managed_class_context", { p_class: classId });   // proves this teacher owns the class
  if (context.error) return reply(403, { ok: false, error: "You can only add learners to your own classes." });
  const svc = admin();
  const allowed = await svc.rpc("qb_consume_budget", { p_key: `managed:${who.user.id}:h`, p_limit: 200, p_seconds: 3600 });
  // The limit counts one per request, then one per account: charge the rest now so a large list cannot slip through in small pieces.
  if (allowed.error || allowed.data === false) return reply(429, { ok: false, error: "Too many accounts created this hour. Please try again later." });
  for (let i = 1; i < names.length; i++) { const more = await svc.rpc("qb_consume_budget", { p_key: `managed:${who.user.id}:h`, p_limit: 200, p_seconds: 3600 }); if (more.data === false) return reply(429, { ok: false, error: "Too many accounts created this hour. Please try again later." }); }

  const created: { first_name: string; username: string; password: string }[] = [];
  const failed: { name: string; reason: string }[] = [];
  for (const raw of names as string[]) {
    const first = raw.trim().replace(/\s+/g, " ");
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      const username = generateUsername(first), password = generatePassword();
      const made = await svc.auth.admin.createUser({ email: `${username}@${MANAGED_EMAIL_DOMAIN}`, password, email_confirm: true, user_metadata: { full_name: first, managed: true } });
      if (made.error || !made.data.user) { if (/already|registered|exists/i.test(made.error?.message ?? "")) continue; failed.push({ name: first, reason: "Could not create the sign-in." }); break; }
      const provisioned = await svc.rpc("qb_managed_learner_provision", { p_teacher: who.user.id, p_class: classId, p_user: made.data.user.id, p_first_name: first, p_username: username, p_consent_ref: consentRef });
      if (provisioned.error) { await svc.auth.admin.deleteUser(made.data.user.id); failed.push({ name: first, reason: "Could not finish setting up the account." }); break; }   // nothing half-created
      created.push({ first_name: first, username, password }); done = true;
    }
    if (!done && !failed.some((f) => f.name === first)) failed.push({ name: first, reason: "Please try this name again." });
  }
  return reply(created.length ? 200 : 502, { ok: created.length > 0, created, failed });
}
