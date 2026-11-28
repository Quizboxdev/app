import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logFallback } from "@/lib/ops/log";
import type { PublicCompetition, PublicListing, PublicResult } from "./types";

// Public pages read through the service role: the database functions return only what anyone may know, and nothing while flags.interschool_public is off.
// If the migrations are not applied or the database is unreachable, the pages show an empty state instead of failing.
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
async function call<T>(fn: string, args: Record<string, unknown>, empty: T): Promise<T> {
  try {
    const { data, error } = await getSupabaseAdminClient().rpc(fn, args);
    if (error) { logFallback("interschool", `${fn} failed`, error); return empty; }
    return (data ?? empty) as T;
  } catch (e) { logFallback("interschool", `${fn} unavailable`, e); return empty; }
}
export const listPublicCompetitions = (limit = 24) => call<PublicListing[]>("interschool_public_list", { p_limit: limit }, []);
export const getPublicCompetition = async (slug: string) => (SLUG.test(slug) && slug.length <= 70 ? call<PublicCompetition | null>("interschool_public_get", { p_slug: slug }, null) : null);
export const getPublicResults = async (slug: string) => (SLUG.test(slug) && slug.length <= 70 ? call<PublicResult[]>("interschool_public_results", { p_slug: slug }, []) : []);
export type Verification = { code: string; kind: string; recipient: string; competition: string; division: string; school: string | null; issued_at: string; valid: boolean; revoked_at: string | null };
export const verifyCertificate = async (code: string) => (/^[A-Za-z0-9-]{6,24}$/.test(code) ? call<Verification | null>("interschool_verify_certificate", { p_code: code }, null) : null);
