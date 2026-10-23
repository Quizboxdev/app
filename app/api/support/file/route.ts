import { authenticate, admin, isUuid, reply } from "@/lib/managed/server";
import { BUCKET } from "@/lib/support/server";

// A short-lived (60 second) download link for one attachment. The database decides who may have it (the person who made the request, or support staff); the file is never public.
export const runtime = "nodejs";

export async function GET(request: Request) {
  const who = await authenticate(request);
  if (!who) return reply(401, { ok: false, error: "Please sign in." });
  const id = new URL(request.url).searchParams.get("id");
  if (!isUuid(id)) return reply(400, { ok: false, error: "Invalid request." });
  const found = await who.client.rpc("qb_support_file_authorize", { p_file: id });
  if (found.error) return reply(404, { ok: false, error: "We could not find that file." });
  const f = found.data as { path: string; file_name: string };
  const signed = await admin().storage.from(BUCKET).createSignedUrl(f.path, 60, { download: f.file_name });
  if (signed.error || !signed.data?.signedUrl) return reply(502, { ok: false, error: "We could not open that file. Please try again." });
  return reply(200, { ok: true, url: signed.data.signedUrl });
}
