// Parses public deep-link parameters for /login. Query strings are untrusted: only exact,
// recognised values survive; anything else falls back to the default login screen.
// SME and school are deliberately not self-registration roles (SME applications are an
// approval-controlled option of teacher onboarding).

export type AuthMode = "login" | "register";
export type RegistrationRole = "student" | "teacher" | "sponsor";
export type RegistrationIntent = "sme";

export type RegistrationParams = {
  mode: AuthMode;
  role: RegistrationRole | null;
  country: string | null;
  intent: RegistrationIntent | null;
};

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams | null | undefined;

const ROLES: readonly RegistrationRole[] = ["student", "teacher", "sponsor"];

function first(raw: RawParams, key: string): string | null {
  if (!raw) return null;
  const value = raw instanceof URLSearchParams ? raw.get(key) : raw[key];
  const single = Array.isArray(value) ? value[0] : value;
  if (typeof single !== "string") return null;
  const trimmed = single.trim();
  return trimmed.length > 0 && trimmed.length <= 32 ? trimmed : null;
}

export function parseRegistrationParams(raw: RawParams): RegistrationParams {
  const mode: AuthMode = first(raw, "mode")?.toLowerCase() === "register" ? "register" : "login";
  if (mode === "login") return { mode, role: null, country: null, intent: null };

  const roleValue = first(raw, "role")?.toLowerCase();
  const role = ROLES.find((r) => r === roleValue) ?? null;

  // Format check only; the country must also exist in the live signup market list before use.
  const countryValue = first(raw, "country")?.toUpperCase() ?? null;
  const country = countryValue && /^[A-Z]{2}$/.test(countryValue) ? countryValue : null;

  // The SME intent only pre-selects the existing "apply as SME" onboarding option for teachers.
  const intent = role === "teacher" && first(raw, "intent")?.toLowerCase() === "sme" ? "sme" : null;

  return { mode, role, country, intent };
}

export function registerHref(params: { role?: RegistrationRole; country?: string; intent?: RegistrationIntent } = {}): string {
  const query = new URLSearchParams({ mode: "register" });
  if (params.role) query.set("role", params.role);
  if (params.country) query.set("country", params.country);
  if (params.intent) query.set("intent", params.intent);
  return `/login?${query.toString()}`;
}
