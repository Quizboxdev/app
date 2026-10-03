import { createClient } from "@supabase/supabase-js";
import { boundedRequest, sponsorError } from "@/lib/competition/request-client";
import { fetchClaimedSources, type SourceRpc } from "@/lib/content/sources/fetch";
export const runtime = "nodejs";
export const maxDuration = 300;

// Super Admin: one bounded fetch execution (at most 5 official PDFs). Authorization, country isolation and the
// official-host allowlist come from SQL with the caller's own JWT; files are stored under the caller's identity.
export async function POST(request: Request) {
  let rpc: SourceRpc | null = null;
  try {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) throw new Error("AUTH_REQUIRED");
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(authorization.slice(7));
    if (error || !data.user) throw new Error("AUTH_REQUIRED");
    const body = JSON.parse((await boundedRequest(request, 2_048)).toString("utf8"));
    const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined;
    const authed: SourceRpc = async (name, args) => { const result = await client.rpc(name, args); if (result.error) throw new Error(result.error.message); return result.data as never; };
    rpc = authed;
    const store = async (path: string, bytes: Buffer) => {
      const { error: upload } = await client.storage.from("curriculum-sources").upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (upload) throw new Error("SOURCE_STORAGE_FAILED");
    };
    return Response.json(await fetchClaimedSources(authed, store, { market_id: uuid(body.market_id), job_id: uuid(body.job_id), limit: Math.min(Math.max(Number(body.limit) || 3, 1), 5) }));
  } catch (error) {
    if (rpc) { const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,60}$/.test(error.message) ? error.message : "OPERATION_FAILED"; await rpc("qb_operation_failure", { p_operation: "IMPORT", p_code: code }).catch(() => undefined); }
    return sponsorError(error);
  }
}
