import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";

// Shared server helpers for the managed-learner routes: who is calling (their own session token, never the service role) and a no-store JSON reply.
export const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function authenticate(request: Request): Promise<{ client: SupabaseClient; user: User } | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(authorization.slice(7));
  return error || !data.user ? null : { client, user: data.user };
}

export const admin = (): SupabaseClient => getSupabaseAdminClient();
export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
export async function readJson(request: Request, maxBytes = 16 * 1024): Promise<Record<string, unknown> | null> {
  const raw = await request.text();
  if (raw.length > maxBytes) return null;
  try { const v = JSON.parse(raw); return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null; } catch { return null; }
}
