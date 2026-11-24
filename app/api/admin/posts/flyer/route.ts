import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { MEDIA_MAX_BYTES, validateImage } from "@/lib/media/validation";

export const runtime = "nodejs";

// Uploads the flyer for a marketing post. Support staff only (the same people who manage posts). The image is checked and re-saved as PNG, then stored in the public marketing-posts bucket under a random name.
export async function POST(request: Request) {
  const token = request.headers.get("authorization");
  if (!token?.startsWith("Bearer ")) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: token } }, auth: { persistSession: false } });
  const { data: { user }, error } = await client.auth.getUser(token.slice(7));
  if (error || !user) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const staff = await client.rpc("qb_support_is_staff");
  if (staff.error || staff.data !== true) return Response.json({ error: "QB_FORBIDDEN" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > MEDIA_MAX_BYTES + 65536) return Response.json({ error: "QB_INVALID_MEDIA" }, { status: 413 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size > MEDIA_MAX_BYTES) throw new Error("QB_INVALID_MEDIA");
    const image = await validateImage(Buffer.from(await file.arrayBuffer()), file.type);
    const path = `${randomUUID()}.png`;
    const up = await getSupabaseAdminClient().storage.from("marketing-posts").upload(path, image.bytes, { contentType: image.mime, upsert: false });
    if (up.error) { console.error("[posts] flyer upload failed:", up.error.message); return Response.json({ error: "QB_UPLOAD_FAILED" }, { status: 502 }); }
    return Response.json({ path, width: image.width, height: image.height });
  } catch {
    return Response.json({ error: "QB_INVALID_MEDIA" }, { status: 400 });
  }
}
