import { authenticate, admin, isUuid, readJson, reply } from "@/lib/managed/server";
import { BUCKET } from "@/lib/support/server";

// Support staff delete a resolved or closed request and its files (the retention period in the Privacy Notice). The database does the permission check and returns the stored file names;
// the server then removes them from the private bucket.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const who = await authenticate(request);
  if (!who) return reply(401, { ok: false });
  const body = await readJson(request);
  const requestId = String(body?.requestId ?? "");
  if (!isUuid(requestId)) return reply(400, { ok: false });
  const done = await who.client.rpc("qb_support_delete", { p_id: requestId });
  if (done.error) {
    if (/QB_SUPPORT_NOT_RESOLVED/.test(done.error.message)) return reply(409, { ok: false, error: "Resolve or close the request before deleting it." });
    return reply(/QB_FORBIDDEN/.test(done.error.message) ? 403 : 404, { ok: false, error: "We could not delete that request." });
  }
  const paths = ((done.data as { paths?: string[] })?.paths ?? []).filter((p) => typeof p === "string");
  if (paths.length) await admin().storage.from(BUCKET).remove(paths);
  return reply(200, { ok: true, files: paths.length });
}
