import { authenticate, reply } from "@/lib/managed/server";
import { extractPolicyText } from "@/lib/policies/extract";

// Admin, Policies: turn an uploaded Word, PDF or text file into text for the editor. The file is not kept. Only an owner or super admin may use it (the database confirms that with the caller's own session),
// the file must be what its name says, and the result is capped. The owner reviews the text and saves it as a draft; nothing is published here.
export const runtime = "nodejs";
const MAX_BYTES = 5 * 1024 * 1024, MAX_CHARS = 200_000;

export async function POST(request: Request) {
  const who = await authenticate(request);
  if (!who) return reply(401, { ok: false, error: "Please sign in." });
  const staff = await who.client.rpc("qb_policy_admin_list");
  if (staff.error) return reply(403, { ok: false, error: "Only an owner or a super admin can manage policies." });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES + 4096) return reply(413, { ok: false, error: "That file is larger than 5 MB." });
  let form: FormData;
  try { form = await request.formData(); } catch { return reply(400, { ok: false, error: "Invalid request." }); }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return reply(400, { ok: false, error: "Choose a file." });
  if (file.size > MAX_BYTES) return reply(413, { ok: false, error: "That file is larger than 5 MB." });
  try {
    const text = await extractPolicyText(file.name.slice(0, 200), new Uint8Array(await file.arrayBuffer()));
    if (!text) return reply(422, { ok: false, error: "We found no text in that file." });
    return reply(200, { ok: true, text: text.slice(0, MAX_CHARS), truncated: text.length > MAX_CHARS });
  } catch (e: any) {
    const code = String(e?.message ?? "");
    return reply(422, { ok: false, error: code === "UNSUPPORTED_TYPE" ? "Use a Word (.docx), PDF or text file." : code.startsWith("NOT_A_") ? "That file does not look like a real document of that type." : "We could not read that file." });
  }
}
