import type { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { hmacHex } from "./crypto";
import { errorResponse, mapDbError } from "./errors";

// Authenticates one Partner API call: rate limit by caller first (so guessing keys is throttled), then the bearer key, then the scope, then a per-partner limit.
// The key is checked in the database against a hash. The service-role client below is used only by this server code; partners never receive it.
export type Scope = "licence:read" | "seats:read" | "seats:write" | "members:read" | "health:read";
type Admin = ReturnType<typeof getSupabaseAdminClient>;
export type PartnerAuth = { partnerId: string; credentialId: string; scopes: string[] };

export const clientHash = (req: Request): string => {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return hmacHex(process.env.INTAKE_HASH_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "partner", ip).slice(0, 32);
};

export async function withinLimit(admin: Admin, key: string, limit: number, seconds: number): Promise<boolean> {
  const { data, error } = await admin.rpc("qb_partner_rate_check", { p_key: key, p_limit: limit, p_seconds: seconds });
  if (error) throw new Error(error.message);                // fail closed: an unreadable limit is not "unlimited"
  return data === true;
}

export async function authenticatePartner(req: Request, scope: Scope, admin: Admin = getSupabaseAdminClient()): Promise<{ ok: true; auth: PartnerAuth; admin: Admin } | { ok: false; response: NextResponse }> {
  try {
    if (!(await withinLimit(admin, `ip:${clientHash(req)}:auth`, 60, 60))) return { ok: false, response: errorResponse("RATE_LIMITED", 60) };
    const m = /^Bearer (qbpk_[0-9a-f]{64})$/.exec(req.headers.get("authorization") ?? "");
    if (!m) return { ok: false, response: errorResponse("AUTH_INVALID") };
    const { data, error } = await admin.rpc("qb_partner_credential_verify", { p_secret: m[1] });
    if (error) return { ok: false, response: errorResponse(mapDbError(error.message) === "FEATURE_DISABLED" ? "FEATURE_DISABLED" : "AUTH_INVALID") };
    const auth: PartnerAuth = { partnerId: data.partner_id, credentialId: data.credential_id, scopes: data.scopes ?? [] };
    if (!auth.scopes.includes(scope)) return { ok: false, response: errorResponse("SCOPE_FORBIDDEN") };
    if (!(await withinLimit(admin, `p:${auth.partnerId}:api`, 120, 60))) return { ok: false, response: errorResponse("RATE_LIMITED", 60) };
    return { ok: true, auth, admin };
  } catch { return { ok: false, response: errorResponse("INTERNAL") }; }
}
