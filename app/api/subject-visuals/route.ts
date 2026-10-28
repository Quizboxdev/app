import { admin, reply } from "@/lib/managed/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = admin();
  const settings = await db.from("platform_settings").select("key,value").eq("scope_type", "global").is("scope_id", null).in("key", ["flags.q_insignia_backend_subject_photos", "flags.q_insignia_concept_photos"]);
  if (settings.error) return reply(503, { error: "SUBJECT_IMAGES_UNAVAILABLE" });
  const values = new Map((settings.data ?? []).map((row) => [row.key, row.value]));
  if (values.get("flags.q_insignia_backend_subject_photos") !== true) return reply(200, { items: [] });
  const allowConcept = values.get("flags.q_insignia_concept_photos") === true;
  let query = db.from("subject_visuals").select("subject_slug,discovery_path,mobile_path,discovery_width,discovery_height,mobile_width,mobile_height,focal_x,focal_y,alt_text,asset_version,asset_status,rights_status").eq("rights_status", "cleared");
  query = allowConcept ? query.in("asset_status", ["approved", "concept"]) : query.eq("asset_status", "approved");
  const { data, error } = await query;
  if (error) return reply(503, { error: "SUBJECT_IMAGES_UNAVAILABLE" });
  const storage = db.storage.from("subject-photos");
  const items = await Promise.all((data ?? []).map(async (item) => {
    const [discovery, mobile] = await Promise.all([
      storage.createSignedUrl(item.discovery_path, 900), storage.createSignedUrl(item.mobile_path, 900),
    ]);
    if (discovery.error || mobile.error || !discovery.data?.signedUrl || !mobile.data?.signedUrl) return null;
    return { slug: item.subject_slug, discovery: { src: discovery.data.signedUrl, width: item.discovery_width, height: item.discovery_height }, mobile: { src: mobile.data.signedUrl, width: item.mobile_width, height: item.mobile_height }, focalPoint: `${item.focal_x}% ${item.focal_y}%`, altText: item.alt_text, version: item.asset_version };
  }));
  return Response.json({ items: items.filter(Boolean) }, { headers: { "Cache-Control": "private, no-store" } });
}
