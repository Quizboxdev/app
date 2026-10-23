import { authenticate, admin, isUuid, reply } from "@/lib/managed/server";
import { MAX_FILE_BYTES, MAX_FILES_PER_UPLOAD } from "@/lib/support/files";
import { prepareFiles, storeFiles } from "@/lib/support/server";

// Attach files to a support request. The caller's own session decides who they are; the database confirms the request is theirs (or that they are support staff) and that it is not closed.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const who = await authenticate(request);
  if (!who) return reply(401, { ok: false, error: "Please sign in." });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_FILE_BYTES * MAX_FILES_PER_UPLOAD + 100 * 1024) return reply(413, { ok: false, error: "The files are too large. Each file can be up to 5 MB." });
  let form: FormData;
  try { form = await request.formData(); } catch { return reply(400, { ok: false, error: "Invalid request." }); }
  const requestId = String(form.get("requestId") ?? ""), messageIn = String(form.get("messageId") ?? "");
  if (!isUuid(requestId) || (messageIn && !isUuid(messageIn))) return reply(400, { ok: false, error: "Invalid request." });
  const allowed = await who.client.rpc("qb_support_request_authorize", { p_id: requestId });
  if (allowed.error) return reply(/QB_SUPPORT_CLOSED/.test(allowed.error.message) ? 409 : 404, { ok: false, error: /QB_SUPPORT_CLOSED/.test(allowed.error.message) ? "This request is closed." : "We could not find that request." });
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return reply(400, { ok: false, error: "Choose a file." });
  const prepared = await prepareFiles(files);
  if (!prepared.ok) return reply(400, { ok: false, error: prepared.error });
  const svc = admin();
  let messageId: string | null = null;
  if (messageIn) { const m = await svc.from("support_request_messages").select("id").eq("id", messageIn).eq("request_id", requestId).maybeSingle(); messageId = (m.data as { id: string } | null)?.id ?? null; }
  const kind = (allowed.data as { kind: "requester" | "staff" }).kind;
  const stored = await storeFiles(svc, requestId, messageId, prepared.files, kind);
  return stored.error ? reply(stored.stored ? 207 : 502, { ok: false, stored: stored.stored, error: stored.error }) : reply(200, { ok: true, stored: stored.stored });
}
