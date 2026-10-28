import { randomUUID } from "node:crypto";
import { admin, authenticate, reply } from "@/lib/managed/server";
import { BRAND_IMAGE_MAX_INPUT_BYTES, optimizeSubjectImagePair } from "@/lib/media/brand-images";
import { SUBJECT_VISUALS } from "@/lib/brand/subject-visuals";

export const runtime = "nodejs";
const allowedSlug = (slug: string) => SUBJECT_VISUALS.some((item) => item.slug === slug);
const statuses = ["approved", "concept", "pending", "rejected"];
const rightsStatuses = ["cleared", "pending", "refused"];

async function staff(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return null;
  const role = await auth.client.rpc("qb_current_role");
  if (role.error || !["ADMIN", "OWNER"].includes(String(role.data).toUpperCase())) return null;
  return auth;
}

export async function GET(request: Request) {
  if (!await staff(request)) return reply(403, { error: "QB_PERMISSION_DENIED" });
  const result = await admin().from("subject_visuals").select("*").order("subject_slug");
  if (result.error) return reply(503, { error: "SUBJECT_IMAGES_UNAVAILABLE" });
  return reply(200, { items: result.data ?? [] });
}

export async function POST(request: Request) {
  const auth = await staff(request);
  if (!auth) return reply(403, { error: "QB_PERMISSION_DENIED" });
  const form = await request.formData().catch(() => null);
  const slug = String(form?.get("subject_slug") ?? "");
  const file = form?.get("file");
  const focalX = Number(form?.get("focal_x") ?? 50), focalY = Number(form?.get("focal_y") ?? 50);
  const altText = String(form?.get("alt_text") ?? "").trim();
  const assetStatus = String(form?.get("asset_status") ?? "pending"), rightsStatus = String(form?.get("rights_status") ?? "pending");
  const rightsNote = String(form?.get("rights_note") ?? "").trim();
  if (!allowedSlug(slug) || !(file instanceof File) || file.size > BRAND_IMAGE_MAX_INPUT_BYTES || !Number.isInteger(focalX) || focalX < 0 || focalX > 100 || !Number.isInteger(focalY) || focalY < 0 || focalY > 100 || altText.length > 300 || !statuses.includes(assetStatus) || !rightsStatuses.includes(rightsStatus) || rightsNote.length > 500 || ((assetStatus === "approved" || rightsStatus === "cleared") && rightsNote.length < 8)) {
    return reply(400, { error: "INVALID_SUBJECT_IMAGE" });
  }
  const storage = admin().storage.from("subject-photos");
  let discoveryPath = "", mobilePath = "";
  try {
    const pair = await optimizeSubjectImagePair(Buffer.from(await file.arrayBuffer()), file.type, { x: focalX, y: focalY });
    const version = randomUUID();
    discoveryPath = `${slug}/${version}-discovery.webp`;
    mobilePath = `${slug}/${version}-mobile.webp`;
    const up1 = await storage.upload(discoveryPath, pair.discovery.bytes, { contentType: "image/webp", upsert: false, cacheControl: "3600" });
    if (up1.error) throw new Error("UPLOAD_FAILED");
    const up2 = await storage.upload(mobilePath, pair.mobile.bytes, { contentType: "image/webp", upsert: false, cacheControl: "3600" });
    if (up2.error) throw new Error("UPLOAD_FAILED");
    const old = await admin().from("subject_visuals").select("discovery_path,mobile_path").eq("subject_slug", slug).maybeSingle();
    const saved = await admin().from("subject_visuals").upsert({
      subject_slug: slug, discovery_path: discoveryPath, mobile_path: mobilePath,
      discovery_width: pair.discovery.width, discovery_height: pair.discovery.height, discovery_bytes: pair.discovery.bytes.byteLength,
      mobile_width: pair.mobile.width, mobile_height: pair.mobile.height, mobile_bytes: pair.mobile.bytes.byteLength,
      focal_x: focalX, focal_y: focalY, alt_text: altText, asset_version: version,
      asset_status: assetStatus, rights_status: rightsStatus, rights_note: rightsNote, updated_by: auth.user.id, updated_at: new Date().toISOString(),
    }, { onConflict: "subject_slug" }).select().single();
    if (saved.error) throw new Error("METADATA_SAVE_FAILED");
    const replaced = [old.data?.discovery_path, old.data?.mobile_path].filter((path): path is string => !!path && path !== discoveryPath && path !== mobilePath);
    if (replaced.length) await storage.remove(replaced);
    return reply(200, { item: saved.data });
  } catch (error) {
    const cleanup = [discoveryPath, mobilePath].filter(Boolean);
    if (cleanup.length) await storage.remove(cleanup);
    const message = error instanceof Error ? error.message : "INVALID_IMAGE";
    const known = ["INVALID_IMAGE", "IMAGE_TOO_LARGE", "UPLOAD_FAILED", "METADATA_SAVE_FAILED"].includes(message) ? message : "INVALID_IMAGE";
    return reply(known === "IMAGE_TOO_LARGE" ? 413 : known === "UPLOAD_FAILED" || known === "METADATA_SAVE_FAILED" ? 503 : 400, { error: known });
  }
}

export async function PATCH(request: Request) {
  const auth = await staff(request);
  if (!auth) return reply(403, { error: "QB_PERMISSION_DENIED" });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const slug = String(body?.subject_slug ?? ""), assetStatus = String(body?.asset_status ?? ""), rightsStatus = String(body?.rights_status ?? ""), rightsNote = String(body?.rights_note ?? "").trim();
  if (!allowedSlug(slug) || !statuses.includes(assetStatus) || !rightsStatuses.includes(rightsStatus) || rightsNote.length > 500 || ((assetStatus === "approved" || rightsStatus === "cleared") && rightsNote.length < 8)) return reply(400, { error: "INVALID_SUBJECT_IMAGE" });
  const result = await admin().from("subject_visuals").update({ asset_status: assetStatus, rights_status: rightsStatus, rights_note: rightsNote, updated_by: auth.user.id, updated_at: new Date().toISOString() }).eq("subject_slug", slug).select().maybeSingle();
  if (result.error || !result.data) return reply(503, { error: "SUBJECT_IMAGE_UPDATE_FAILED" });
  return reply(200, { item: result.data });
}
