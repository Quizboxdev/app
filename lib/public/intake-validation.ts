import type { InterestKind } from "./intake";

// One validator shared by the browser (to give instant messages) and the server route (the real gate). It mirrors the database constraints in
// 20261018150000_public_interest_intake.sql, trims input and rejects unknown fields, so arbitrary JSON is never accepted.
export type Submission = {
  category: "SPONSOR" | "SME" | "SCHOOL" | "COUNTRY" | "CONTACT";
  name: string; email: string; phone?: string; country_name?: string; organization?: string; subject?: string; message: string;
  metadata: Record<string, string>; consent: true;
};

const CATEGORY: Record<InterestKind, Submission["category"]> = { sponsor: "SPONSOR", sme: "SME", school: "SCHOOL", country: "COUNTRY", contact: "CONTACT" };
const META_KEYS: Record<Submission["category"], readonly string[]> = {
  SPONSOR: ["sponsor_type", "intended_audience"], SME: ["education_levels", "professional_role", "years_experience"],
  SCHOOL: ["institution_type", "estimated_learners", "contact_person"], COUNTRY: ["role", "curriculum"], CONTACT: ["enquiry_type"],
};
const ALLOWED_KEYS = new Set(["category", "name", "email", "phone", "country_name", "organization", "subject", "message", "metadata", "consent"]);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const PHONE = /^[0-9+() .-]{6,32}$/;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const clip = (v: string, n: number) => v.slice(0, n);

// Browser side: map each public form's own field names onto the one submission shape.
export function toSubmission(kind: InterestKind, f: Record<string, string>, consent: boolean): Record<string, unknown> {
  const g = (k: string) => text(f[k]);
  const meta = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, clip(g(k), 300)]).filter(([, v]) => v));
  const base = { category: CATEGORY[kind], email: g("email"), consent };
  switch (kind) {
    case "sponsor": return { ...base, name: g("name"), phone: g("phone") || undefined, organization: g("organization") || undefined, country_name: g("country") || undefined,
      message: g("interest_summary"), metadata: meta(["sponsor_type", "intended_audience"]) };
    case "sme": return { ...base, name: g("full_name"), country_name: g("country") || undefined, subject: g("subjects") || undefined,
      message: g("qualification_summary"), metadata: meta(["education_levels", "professional_role", "years_experience"]) };
    case "school": return { ...base, name: g("contact_person"), organization: g("institution_name") || undefined, country_name: g("country") || undefined,
      message: g("message") || `Interest from ${g("institution_name")}`, metadata: meta(["institution_type", "estimated_learners", "contact_person"]) };
    case "country": return { ...base, name: g("name"), country_name: g("country") || undefined, message: `Curriculum or level: ${g("curriculum") || "not given"}`, metadata: meta(["role", "curriculum"]) };
    default: return { ...base, name: g("name"), country_name: g("country") || undefined, message: g("message"), metadata: meta(["enquiry_type"]) };
  }
}

export type Validation = { ok: true; value: Submission } | { ok: false; error: string };
export function validateSubmission(input: unknown): Validation {
  const bad = (error: string): Validation => ({ ok: false, error });
  if (!input || typeof input !== "object" || Array.isArray(input)) return bad("Invalid request.");
  const o = input as Record<string, unknown>;
  if (Object.keys(o).some((k) => !ALLOWED_KEYS.has(k))) return bad("Invalid request.");
  const category = o.category as Submission["category"];
  if (!Object.keys(META_KEYS).includes(category)) return bad("Invalid request.");
  if (o.consent !== true) return bad("Please tick the box to agree before sending.");
  const name = text(o.name), email = text(o.email).toLowerCase(), message = text(o.message);
  if (name.length < 2 || name.length > 150) return bad("Please enter your name.");
  if (email.length < 6 || email.length > 254 || !EMAIL.test(email)) return bad("Please enter a valid email address.");
  if (message.length < 1 || message.length > 2000) return bad("Please write a message of up to 2000 characters.");
  const phone = text(o.phone); if (phone && !PHONE.test(phone)) return bad("Please enter a valid phone number.");
  const optional = (v: unknown, max: number, label: string): string | undefined | null => { const t = text(v); if (!t) return undefined; return t.length > max ? null : (void label, t); };
  const country_name = optional(o.country_name, 80, "country"), organization = optional(o.organization, 200, "organization"), subject = optional(o.subject, 200, "subject");
  if (country_name === null || organization === null || subject === null) return bad("One of the fields is too long.");
  const metaIn = o.metadata ?? {};
  if (typeof metaIn !== "object" || Array.isArray(metaIn)) return bad("Invalid request.");
  const metadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(metaIn as Record<string, unknown>)) {
    if (!META_KEYS[category].includes(k) || typeof v !== "string" || v.length > 300) return bad("Invalid request.");
    if (v.trim()) metadata[k] = v.trim();
  }
  return { ok: true, value: { category, name, email, ...(phone ? { phone } : {}), ...(country_name ? { country_name } : {}), ...(organization ? { organization } : {}), ...(subject ? { subject } : {}), message, metadata, consent: true } };
}
