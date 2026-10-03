import { createClient } from "@supabase/supabase-js";
import { boundedRequest, sponsorError } from "@/lib/competition/request-client";
import { configuredFactoryProvider, executeCampaignJobs, type FactoryRpc } from "@/lib/content/factory/campaign";
export const runtime = "nodejs";

// One bounded Content Factory execution (at most the campaign's max_jobs_per_execution provider calls).
// Every RPC runs with the caller's own JWT, so content-admin, market and source authorization stay in SQL.
export async function POST(request: Request) {
  let rpc: FactoryRpc | null = null;
  try {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) throw new Error("AUTH_REQUIRED");
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(authorization.slice(7));
    if (error || !data.user) throw new Error("AUTH_REQUIRED");
    const body = JSON.parse((await boundedRequest(request, 4_096)).toString("utf8"));
    if (typeof body.campaign_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.campaign_id)) throw new Error("INVALID_FACTORY_INPUT");
    const authed: FactoryRpc = async (name, args) => { const result = await client.rpc(name, args); if (result.error) throw new Error(result.error.message); return result.data as never; };
    rpc = authed;
    return Response.json(await executeCampaignJobs(authed, body.campaign_id, configuredFactoryProvider(process.env)));
  } catch (error) {
    if (rpc) { const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,60}$/.test(error.message) ? error.message : "OPERATION_FAILED"; await rpc("qb_operation_failure", { p_operation: "GENERATION", p_code: code }).catch(() => undefined); }
    return sponsorError(error);
  }
}
