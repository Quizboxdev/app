import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { MEDIA_MAX_BYTES, validateImage } from "@/lib/media/validation";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const token = request.headers.get("authorization");
  if (!token?.startsWith("Bearer ")) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: token } }, auth: { persistSession: false } });
  const { data: { user }, error } = await client.auth.getUser(token.slice(7));
  if (error || !user) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const role = await client.rpc("qb_current_role");
  if (!["ADMIN","OWNER"].includes(role.data)) return Response.json({ error: "QB_PERMISSION_DENIED" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > MEDIA_MAX_BYTES + 65536) return Response.json({ error: "QB_INVALID_MEDIA" }, { status: 413 });
  try {
    // Bound streamed input even when Content-Length is absent or dishonest.
    const reader = request.body?.getReader(); if (!reader) throw new Error("QB_INVALID_MEDIA");
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > MEDIA_MAX_BYTES + 65536) { await reader.cancel(); throw new Error("QB_INVALID_MEDIA"); } chunks.push(chunk.value); }
    const form = await new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type") ?? "" }, body: Buffer.concat(chunks) }).formData();
    const file = form.get("file"), alt = String(form.get("alt") ?? ""), questionId = String(form.get("question_id") ?? ""), version = Number(form.get("version"));
    if (!(file instanceof File) || file.size > MEDIA_MAX_BYTES || !alt.trim() || alt.length > 300 || /<[^>]*>|correct answer|answer key|the answer is/i.test(alt) || !/^[0-9a-f-]{36}$/i.test(questionId) || !Number.isInteger(version)) throw new Error("QB_INVALID_MEDIA");
    const image = await validateImage(Buffer.from(await file.arrayBuffer()), file.type);
    const id = randomUUID(), storagePath = "validated/" + user.id + "/" + id + ".png";
    const upload = await client.storage.from("question-media").upload(storagePath, image.bytes, { contentType: image.mime, upsert: false });
    if (upload.error) throw new Error("QB_MEDIA_UPLOAD_FAILED");
    const asset = await client.from("media_assets").insert({ id, storage_bucket: "question-media", storage_path: storagePath, media_type: "IMAGE", mime_type: image.mime, width: image.width, height: image.height, byte_size: image.bytes.length, validated_at: new Date().toISOString(), alt_text: alt, checksum: createHash("sha256").update(image.bytes).digest("hex"), status: "ACTIVE", created_by: user.id, source_type: "EDITORIAL_UPLOAD" });
    if (asset.error) throw new Error("QB_MEDIA_METADATA_FAILED");
    const attached = await client.rpc("qb_attach_question_media", { p_question_id: questionId, p_asset_id: id, p_version: version, p_note: String(form.get("note") ?? "Attach validated diagram; human re-review required.") });
    if (attached.error) {
      await client.from("media_assets").update({ status: "INACTIVE" }).eq("id", id);
      return Response.json({ error: "QB_MEDIA_ATTACH_FAILED", asset_id: id }, { status: 409 });
    }
    return Response.json({ asset_id: id, question_id: questionId, review_required: true });
  } catch { return Response.json({ error: "QB_INVALID_MEDIA" }, { status: 400 }); }
}
