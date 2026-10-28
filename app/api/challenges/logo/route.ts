import { randomUUID } from "node:crypto";
import { admin, authenticate, isUuid, reply } from "@/lib/managed/server";
import { optimizeSponsorLogo, BRAND_IMAGE_MAX_INPUT_BYTES } from "@/lib/media/brand-images";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return reply(401, { error: "AUTH_REQUIRED" });
  const form = await request.formData().catch(() => null);
  const campaignId = form?.get("campaign_id");
  const file = form?.get("file");
  if (!isUuid(campaignId) || !(file instanceof File)) return reply(400, { error: "INVALID_UPLOAD" });
  if (file.size > BRAND_IMAGE_MAX_INPUT_BYTES) return reply(413, { error: "IMAGE_TOO_LARGE" });

  const access = await auth.client.rpc("challenge_creator_get", { p_id: campaignId });
  if (access.error || !access.data?.campaign) return reply(403, { error: "QB_PERMISSION_DENIED" });
  try {
    const output = await optimizeSponsorLogo(Buffer.from(await file.arrayBuffer()), file.type);
    const path = `campaigns/${campaignId}/${randomUUID()}.webp`;
    const stored = await admin().storage.from("sponsor-branding").upload(path, output.bytes, { contentType: "image/webp", upsert: false, cacheControl: "31536000" });
    if (stored.error) return reply(503, { error: "UPLOAD_FAILED" });
    return reply(200, { path, width: output.width, height: output.height, byte_size: output.bytes.byteLength });
  } catch (error) {
    const code = error instanceof Error && ["INVALID_IMAGE", "IMAGE_TOO_LARGE"].includes(error.message) ? error.message : "INVALID_IMAGE";
    return reply(code === "IMAGE_TOO_LARGE" ? 413 : 400, { error: code });
  }
}
