import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { SITE_URL } from "@/lib/site";
import { MAX_FILE_BYTES, MAX_FILES_PER_UPLOAD } from "@/lib/support/files";
import { emailStaffNew, emailVisitorReceived, prepareFiles, storeFiles, type SupportRequestRow } from "@/lib/support/server";

// The public contact form. Same origin only, multipart (text plus up to 3 files of 5 MB), a hidden field and a minimum time on the page to stop simple bots, strict checks, then a database function
// with limits per device and per email address. Files are checked by content before anything is created. The answer never echoes what was sent.
export const runtime = "nodejs";
const CATEGORY: Record<string, string> = { "General enquiry": "other", "Account support": "account", "Payment or refund": "payment" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const out = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin"); if (!origin) return false;
  try { const o = new URL(origin).host, host = req.headers.get("host") ?? "", site = new URL(SITE_URL).host; return o === host || o === site || o === `www.${site}`; } catch { return false; }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return out(403, { ok: false });
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) return out(415, { ok: false });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FILE_BYTES * MAX_FILES_PER_UPLOAD + 100 * 1024) return out(413, { ok: false, error: "The files are too large. Each file can be up to 5 MB." });
  let form: FormData;
  try { form = await req.formData(); } catch { return out(400, { ok: false, error: "Invalid request." }); }
  const text = (k: string) => String(form.get(k) ?? "").trim();
  // Bots fill the hidden field and submit instantly; both look like success to them but nothing is stored.
  if (text("website") || !(Number(text("elapsed_ms")) >= 3000)) return out(202, { ok: true });
  const name = text("name"), email = text("email").toLowerCase(), type = text("enquiry_type"), message = text("message"), category = CATEGORY[type];
  if (!category || name.length < 1 || name.length > 120 || !EMAIL.test(email) || email.length > 200 || message.length < 10 || message.length > 5000 || form.get("consent") !== "on") return out(400, { ok: false, error: "Please check your details and try again." });
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const prepared = await prepareFiles(files);
  if (!prepared.ok) return out(400, { ok: false, error: prepared.error });
  const salt = process.env.INTAKE_HASH_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!salt) return out(503, { ok: false, error: "Sending is temporarily unavailable. Please try again later." });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const clientHash = createHmac("sha256", salt).update(ip).digest("hex");                  // pseudonymous; the address itself is never stored
  const admin = getSupabaseAdminClient();
  const subject = `${type}: ${message.replace(/\s+/g, " ").slice(0, 80)}`;
  const created = await admin.rpc("qb_support_create_public", { p_name: name, p_email: email, p_category: category, p_subject: subject, p_message: message, p_client_hash: clientHash });
  if (created.error) {
    if (/QB_RATE_LIMITED/.test(created.error.message)) return out(429, { ok: false, error: "Too many messages. Please try again later." });
    if (/QB_SUPPORT_INVALID/.test(created.error.message)) return out(400, { ok: false, error: "Please check your details and try again." });
    console.error("[support] public request not created:", created.error.message.slice(0, 160));
    return out(503, { ok: false, error: "Sending is temporarily unavailable. Please try again later." });
  }
  const { id, reference } = created.data as { id: string; reference: string };
  const stored = prepared.files.length ? await storeFiles(admin, id, null, prepared.files, "requester") : { stored: 0 };
  const row: SupportRequestRow = { id, reference, subject, category, requester_name: name, requester_email: email, requester_user_id: null, status: "open" };
  await Promise.allSettled([emailVisitorReceived(row), emailStaffNew(admin, row)]);
  return out(202, { ok: true, reference, filesFailed: Boolean(stored.error) });
}
