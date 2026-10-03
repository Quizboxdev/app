import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";

export type ConfigOption = { code: string; label: string; level?: string };
export type SignupCountry = { country_code: string; country: string; market_id: string | null; market: string | null; available: boolean; locale: string; education_levels: ConfigOption[]; grades: ConfigOption[]; subjects: ConfigOption[] };
export type OnboardingRole = "student" | "teacher" | "sponsor";
export type Account = {
  role: string; full_name: string; email: string; country: string | null; school_name: string | null; onboarded: boolean;
  primary_market: { id: string; name: string; locale: string; timezone: string; currency: string } | null;
  active_market: { id: string; name: string } | null; authorized_markets: Array<{ id: string; name: string; primary: boolean }>;
  student: { grade_code: string | null; education_level: string | null; subjects: string[] } | null;
  teacher: { subjects: string[]; grade_codes: string[]; education_levels: string[] } | null;
  pending_market_change: { id: string; to_market: string; created_at: string } | null;
};
export type MarketStatus = "DRAFT" | "CONFIGURING" | "READY" | "ACTIVE" | "SUSPENDED";
export type Readiness = { market_id: string; status: MarketStatus; ready: boolean; blockers: string[]; sme_coverage: number };
export type MarketRow = { id: string; name: string; country: string; country_code: string; currency: string; timezone: string; locale: string; status: MarketStatus; is_test: boolean; configuration: Record<string, unknown>; readiness: Readiness };

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(name, args);
  if (error) throw new Error(userFacingError(error));
  return data as T;
}

export const listSignupCountries = () => call<SignupCountry[]>("qb_signup_markets");
export const completeOnboarding = (data: Record<string, unknown>) => call<{ role: OnboardingRole; market: string }>("qb_complete_onboarding", { p: data });
export const getMyAccount = () => call<Account>("qb_my_account");
export const requestMarketChange = (market: string, reason: string) => call("qb_request_market_change", { p_to_market: market, p_reason: reason });
export const setAssignmentGradeOverride = (assignment: string, reason: string) => call("qb_set_assignment_grade_override", { p_assignment: assignment, p_reason: reason });
export const marketSetup = <T>(action: string, data: Record<string, unknown> = {}) => call<T>("qb_market_setup", { p_action: action, p_data: data });
export const marketAdmin = <T>(action: string, data: Record<string, unknown> = {}) => call<T>("qb_market_admin", { p_action: action, p_data: data });

// Market-defined option lists ("code: label" one per line) used by the Super Admin market setup.
export function parseOptions(text: string): ConfigOption[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [code, rest = ""] = line.split(":").map(part => part.trim()); const [label, level] = rest.split("|").map(part => part.trim());
    return { code, label: label || code, ...(level ? { level } : {}) };
  });
}
export const formatOptions = (options: unknown) => (Array.isArray(options) ? options as ConfigOption[] : []).map(o => `${o.code}: ${o.label}${o.level ? ` | ${o.level}` : ""}`).join("\n");
