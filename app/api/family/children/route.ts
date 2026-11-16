import { randomBytes } from "node:crypto";
import { MANAGED_EMAIL_DOMAIN, generateUsername } from "@/lib/managed/identity";
import { admin, authenticate, readJson, reply } from "@/lib/managed/server";
import { parseChildInput } from "@/lib/family/child-input";

// A parent adds a child: the child gets an ordinary student sign-in (no email, a username) that nobody knows the password to, is linked to the parent's workspace,
// and the parent gets a single-use link for the child to choose their own password. Only the parent's own session says who they are; the database checks the rest.
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const who = await authenticate(request);
  if (!who) return reply(401, { ok: false, error: "Please sign in." });
  const body = await readJson(request);
  if (!body) return reply(400, { ok: false, error: "Invalid request." });
  const parsed = parseChildInput(body);
  if (!parsed.ok) return reply(400, { ok: false, error: parsed.error });
  const c = parsed.value;

  const open = await who.client.rpc("qb_family_open", {});
  if (open.error) return reply(/QB_FEATURE_DISABLED/.test(open.error.message) ? 403 : /QB_FAMILY_NOT_ADULT/.test(open.error.message) ? 403 : 400, { ok: false, error: /QB_FEATURE_DISABLED/.test(open.error.message) ? "The Family workspace is not open yet." : "Only an adult account can add children." });
  const svc = admin();
  const budget = await svc.rpc("qb_consume_budget", { p_key: `family-child:${who.user.id}:h`, p_limit: 30, p_seconds: 3600 });
  if (budget.error || budget.data === false) return reply(429, { ok: false, error: "Too many children added this hour. Please try again later." });

  for (let attempt = 0; attempt < 3; attempt++) {
    const username = generateUsername(c.firstName);
    const made = await svc.auth.admin.createUser({ email: `${username}@${MANAGED_EMAIL_DOMAIN}`, password: randomBytes(24).toString("base64url"), email_confirm: true, user_metadata: { full_name: c.displayName || c.firstName, managed: true, family: true } });
    if (made.error || !made.data.user) { if (/already|registered|exists/i.test(made.error?.message ?? "")) continue; return reply(502, { ok: false, error: "Could not create the sign-in. Please try again." }); }
    const done = await svc.rpc("qb_family_child_provision", { p_parent: who.user.id, p_user: made.data.user.id, p_first_name: c.firstName, p_last_name: c.lastName, p_display_name: c.displayName, p_age: c.age, p_grade_code: c.gradeCode, p_school: c.school, p_username: username, p_consent_ref: "parent-confirmed at sign-up" });
    if (done.error) {
      await svc.auth.admin.deleteUser(made.data.user.id);   // nothing half-created
      return reply(/QB_FAMILY_GRADE_INVALID/.test(done.error.message) ? 400 : 502, { ok: false, error: /QB_FAMILY_GRADE_INVALID/.test(done.error.message) ? "That class is not offered in your country yet." : "Could not finish setting up the account. Please try again." });
    }
    const invite = await who.client.rpc("qb_family_invite_issue", { p_student: made.data.user.id });
    if (invite.error) return reply(200, { ok: true, studentId: made.data.user.id, username, token: null, note: "Child added. Press Resend invitation to get their link." });
    return reply(200, { ok: true, studentId: made.data.user.id, username, token: invite.data.token, expiresAt: invite.data.expires_at });
  }
  return reply(502, { ok: false, error: "Please try again." });
}
