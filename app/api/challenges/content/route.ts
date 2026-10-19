import mammoth from "mammoth";
import { authenticate, isUuid, reply } from "@/lib/managed/server";
import { chunkText, sha256Hex } from "@/lib/challenges/chunker";
import { pdfPages } from "@/lib/pdf";

// A challenge creator uploads a book or notes (PDF, Word, text) or pastes text. The server extracts the text, splits it into passages and stores each upload as a new version.
// The file itself is not kept: only the passages the creator's questions will cite. The database call runs as the signed-in creator, so ownership is checked there, not here.
export const runtime = "nodejs";
const MAX_BYTES = 8 * 1024 * 1024;

async function extract(name: string, bytes: Uint8Array): Promise<string> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") { if (String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") throw new Error("NOT_A_PDF"); return (await pdfPages(bytes)).map((p) => p.text).join("\n\n"); }
  if (ext === "docx") { if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("NOT_A_DOCX"); return (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value; }
  if (ext === "txt" || ext === "md") return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  throw new Error("UNSUPPORTED_TYPE");
}

export async function POST(request: Request) {
  const who = await authenticate(request);
  if (!who) return reply(401, { ok: false, error: "Please sign in." });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES + 4096) return reply(413, { ok: false, error: "That file is larger than 8 MB." });
  let form: FormData;
  try { form = await request.formData(); } catch { return reply(400, { ok: false, error: "Invalid request." }); }
  const campaignId = String(form.get("campaignId") ?? ""), title = String(form.get("title") ?? "").trim();
  const kind = String(form.get("kind") ?? "book"), assetId = String(form.get("assetId") ?? "");
  if (!isUuid(campaignId) || title.length < 2 || !["book", "article", "notes"].includes(kind) || (assetId && !isUuid(assetId))) return reply(400, { ok: false, error: "Please check the title and try again." });
  if (form.get("rights") !== "true") return reply(400, { ok: false, error: "Please confirm you have the right to use this material." });

  let bytes: Uint8Array, sourceName: string;
  const file = form.get("file"), pasted = String(form.get("text") ?? "");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return reply(413, { ok: false, error: "That file is larger than 8 MB." });
    bytes = new Uint8Array(await file.arrayBuffer()); sourceName = file.name.slice(0, 200);
  } else if (pasted.trim().length >= 40 && pasted.length <= 600_000) { bytes = new TextEncoder().encode(pasted); sourceName = "pasted.txt"; }
  else return reply(400, { ok: false, error: "Choose a file or paste at least a few sentences." });

  let text: string;
  try { text = await extract(sourceName, bytes); } catch (e: any) {
    const code = String(e?.message ?? "");
    return reply(422, { ok: false, error: code === "UNSUPPORTED_TYPE" ? "Use a PDF, Word (.docx) or text file." : code.startsWith("NOT_A_") ? "That file does not look like a real document of that type." : "We could not read that file. Try a text copy instead." });
  }
  const chunks = chunkText(text);
  if (!chunks.length) return reply(422, { ok: false, error: "No readable text was found. Scanned pages need to be typed or run through text recognition first." });
  const { data, error } = await who.client.rpc("challenge_content_add", {
    p_campaign: campaignId, p_title: title, p_kind: kind, p_source_name: sourceName, p_sha256: await sha256Hex(bytes), p_chunks: chunks, p_rights: true, p_asset: assetId || null,
  });
  if (error) {
    const m = error.message ?? "";
    return reply(/NOT_AUTHORIZED|NOT_FOUND/.test(m) ? 403 : 400, { ok: false, error: /RATE_LIMITED/.test(m) ? "This challenge already has the maximum number of sources." : /NOT_AUTHORIZED|NOT_FOUND/.test(m) ? "You can only add material to your own challenges." : "The material could not be saved." });
  }
  return reply(200, { ok: true, ...(data as Record<string, unknown>), passages: chunks.length });
}
