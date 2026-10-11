import { createClient } from "@supabase/supabase-js";
import { boundedRequest, sponsorError } from "@/lib/competition/request-client";
import { acceptSuppliedPdf } from "@/lib/content/sources/supplied";
import type { SourceRpc } from "@/lib/content/sources/fetch";
export const runtime = "nodejs";
export const maxDuration = 120;

// Vercel limits a function request body to 4.5 MB.
const MAX_UPLOAD_BYTES = 4_400_000;

// Super Admin: attach an official PDF to one source row. The body is the PDF itself; the row is named in the x-registry-id header.
// Authorization, country isolation and the review steps come from SQL with the caller's own JWT.
export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) throw new Error("AUTH_REQUIRED");
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(authorization.slice(7));
    if (error || !data.user) throw new Error("AUTH_REQUIRED");
    const id = request.headers.get("x-registry-id") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("QB_SOURCE_NOT_FOUND");
    const rpc: SourceRpc = async (name, args) => { const result = await client.rpc(name, args); if (result.error) throw new Error(result.error.message); return result.data as never; };
    const store = async (path: string, file: Buffer) => {
      const { error: upload } = await client.storage.from("curriculum-sources").upload(path, file, { contentType: "application/pdf", upsert: false });
      if (upload) throw new Error("SOURCE_STORAGE_FAILED");
    };
    // Large files are placed in the bucket by the browser and named here; the body is then only {"path": "..."}.
    if ((request.headers.get("content-type") ?? "").startsWith("application/json")) {
      const body = JSON.parse((await boundedRequest(request, 2_048)).toString("utf8")) as { path?: unknown };
      const path = typeof body.path === "string" ? body.path : "";
      if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/i.test(path)) throw new Error("QB_SOURCE_FETCH_RESULT_INVALID");
      const { data: blob, error: read } = await client.storage.from("curriculum-sources").download(path);
      if (read || !blob) throw new Error("SOURCE_STORAGE_FAILED");
      return Response.json(await acceptSuppliedPdf(rpc, store, id, Buffer.from(await blob.arrayBuffer()), undefined, { storedPath: path }));
    }
    const bytes = await boundedRequest(request, MAX_UPLOAD_BYTES);
    return Response.json(await acceptSuppliedPdf(rpc, store, id, bytes));
  } catch (error) {
    return sponsorError(error);
  }
}
