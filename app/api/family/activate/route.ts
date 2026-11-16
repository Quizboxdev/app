import { admin, readJson, reply } from "@/lib/managed/server";
import { passwordProblem } from "@/lib/password-policy";

// The child opens their single-use link and chooses a password. No sign-in is needed (the link is the proof), so this is rate limited by address and the link is used up
// atomically in the database: a second use, an expired link and a revoked link all fail. The link never signs anyone in: the child signs in normally afterwards.
export const runtime = "nodejs";

const ip = (request: Request) => (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
const TOKEN = /^[0-9a-f]{64}$/;

async function allowed(request: Request) {
  const r = await admin().rpc("qb_consume_budget", { p_key: `family-activate:${ip(request)}:h`, p_limit: 40, p_seconds: 3600 });
  return !r.error && r.data !== false;
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!TOKEN.test(token)) return reply(200, { valid: false });
  if (!(await allowed(request))) return reply(429, { valid: false, error: "Too many tries. Please wait a little." });
  const peek = await admin().rpc("qb_family_invite_peek", { p_token: token });
  return reply(200, { valid: peek.data?.valid === true, firstName: peek.data?.first_name ?? "" });
}

export async function POST(request: Request) {
  const body = await readJson(request, 2048);
  const token = typeof body?.token === "string" ? body.token : "", password = typeof body?.password === "string" ? body.password : "";
  if (!TOKEN.test(token)) return reply(400, { ok: false, error: "This link is not valid. Ask your parent for a new one." });
  const problem = passwordProblem(password);
  if (problem) return reply(400, { ok: false, error: problem });
  if (!(await allowed(request))) return reply(429, { ok: false, error: "Too many tries. Please wait a little." });
  const svc = admin();
  const used = await svc.rpc("qb_family_invite_consume", { p_token: token });
  if (used.error || !used.data?.student_id) return reply(400, { ok: false, error: "This link has already been used or has expired. Ask your parent for a new one." });
  const updated = await svc.auth.admin.updateUserById(used.data.student_id, { password });
  if (updated.error) return reply(502, { ok: false, error: "We could not save your password. Ask your parent for a new link." });
  return reply(200, { ok: true, username: used.data.username });
}
