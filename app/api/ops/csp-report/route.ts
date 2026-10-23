import { summariseReport } from "@/lib/security/csp-report";

// Receives Content-Security-Policy violation reports from browsers and writes a one-line summary to the function logs, so the policy can be checked before it is enforced (lib/security/headers.ts).
// Anyone can post here, so it is careful: tiny body, nothing is stored, at most 30 lines a minute per server instance, and it always answers 204 so it can never be used to probe the system.
export const runtime = "nodejs";
const done = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
let windowStart = 0, count = 0;

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length === 0 || raw.length > 8 * 1024) return done();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return done(); }
  const s = summariseReport(parsed);
  if (!s) return done();
  const now = Date.now();
  if (now - windowStart > 60_000) { windowStart = now; count = 0; }
  if (++count <= 30) console.warn(`[csp] ${s.mode} directive=${s.directive} blocked=${s.blocked} page=${s.page}`);
  return done();
}
