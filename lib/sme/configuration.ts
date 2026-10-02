export type ConfigField = { name: string; label: string; type?: "text" | "number" | "checkbox" | "textarea" | "datetime-local" | "select"; optional?: boolean; options?: string[]; source?: string; valueKey?: string; min?: number };
const field = (name: string, label: string, extra: Partial<ConfigField> = {}): ConfigField => ({ name, label, ...extra });
const active = field("active", "Active", { type: "checkbox" });
const market = field("market_id", "Market", { optional: true, source: "markets" });
const currency = field("currency_code", "Currency", { source: "currencies", valueKey: "code" });
export const SME_CONFIG_FIELDS: Record<string, ConfigField[]> = {
  currencies: [field("code", "ISO 4217 code"), field("name", "Name"), field("symbol", "Symbol"), field("decimal_places", "Decimal places", { type: "number", min: 0 }), active],
  countries: [field("iso2_code", "ISO alpha-2"), field("iso3_code", "ISO alpha-3"), field("name", "Name"), { ...currency, name: "default_currency_code" }, field("timezone", "Time zone"), field("locale", "Locale"), active],
  markets: [field("country_id", "Country", { source: "countries" }), field("name", "Name"), { ...currency, name: "default_currency_code" }, field("timezone", "Time zone"), field("locale", "Locale"), field("require_senior_qa", "Require independent senior QA", { type: "checkbox" }), active],
  sme_profiles: [field("user_id", "Existing profile UUID"), field("reviewer_status", "Reviewer status", { type: "select", options: ["pending", "verified", "suspended"] }), field("country_id", "Country", { optional: true, source: "countries" }), { ...currency, name: "preferred_currency_code", optional: true }, field("reviewer_tier", "Tier"), field("qualification_summary", "Qualifications", { type: "textarea", optional: true }), field("years_experience", "Years of experience", { type: "number", min: 0 }), field("bio", "Biography", { type: "textarea", optional: true }), field("payment_status", "Payment verification", { type: "select", options: ["pending", "verified", "held"] }), active],
  sme_domain_assignments: [field("reviewer_id", "Reviewer", { source: "sme_profiles", valueKey: "user_id" }), field("subject_code", "Subject code / reference"), field("curriculum_id", "Curriculum UUID", { optional: true }), market, field("education_level", "Education level", { optional: true }), field("grade_codes", "Canonical grade codes (comma separated)", { optional: true }), field("specialization", "Specialization", { optional: true }), ...["can_review", "can_approve", "can_senior_review"].map(name => field(name, name.replaceAll("_", " "), { type: "checkbox" })), active],
  compensation_policies: [field("name", "Policy name"), market, field("sponsor_id", "Sponsor profile UUID", { optional: true }), field("tenant_id", "Tenant UUID", { optional: true }), field("reviewer_tier", "Tier scope", { optional: true }), field("subject_code", "Subject scope", { optional: true }), field("education_level", "Education level scope", { optional: true }), active],
  compensation_policy_versions: [field("policy_id", "Policy", { source: "compensation_policies" }), currency, field("effective_from", "Effective from", { type: "datetime-local" }), field("effective_to", "Effective to", { type: "datetime-local", optional: true }), ...["base_review_fee", "approve_fee", "reject_fee", "revision_fee", "senior_review_fee", "quality_bonus_amount", "minimum_payout_threshold", "complexity_multiplier"].map(name => field(name, name.replaceAll("_", " "), { type: "number", min: name === "complexity_multiplier" ? 0.000001 : 0, optional: name === "minimum_payout_threshold" })), field("withholding_percentage", "Withholding percent", { type: "number", min: 0 }), field("funded_by", "Funding source")],
  user_capabilities: [field("user_id", "Existing profile UUID"), field("capability", "Capability", { type: "select", options: ["super_admin", "content_admin", "sme_reviewer", "senior_sme_reviewer", "competition_admin", "sponsor_admin", "finance_admin"] }), active],
};

export function configurationPayload(entity: string, form: FormData, id?: string) {
  const fields = SME_CONFIG_FIELDS[entity];
  if (!fields) throw new Error("Unknown configuration entity.");
  const payload: Record<string, unknown> = {};
  for (const item of fields) {
    const value = String(form.get(item.name) ?? "").trim();
    if (item.name === "require_senior_qa") payload.configuration = { require_senior_qa: form.has(item.name) };
    else if (item.type === "checkbox") payload[item.name] = form.has(item.name);
    else if (item.name === "grade_codes") payload[item.name] = value ? value.split(",").map(code => code.trim()).filter(Boolean) : [];
    else if (item.name === "withholding_percentage") {
      if (!value || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100) throw new Error("Withholding must be between 0 and 100.");
      payload.tax_or_withholding = { percentage: value };
    } else if (!value) {
      if (!item.optional) throw new Error(`${item.label} is required.`);
      payload[item.name] = ["qualification_summary", "bio", "specialization"].includes(item.name) ? "" : null;
    } else if (item.type === "datetime-local") payload[item.name] = new Date(value).toISOString();
    else if (item.type === "number") {
      if (!/^\d+(\.\d{1,6})?$/.test(value) || Number(value) < (item.min ?? 0)) throw new Error(`Invalid ${item.label}.`);
      payload[item.name] = value;
    } else payload[item.name] = value;
  }
  if (entity === "currencies" && (!/^[A-Z]{3}$/.test(String(payload.code)) || !Intl.supportedValuesOf("currency").includes(String(payload.code)) || Number(payload.decimal_places) > 6 || !Number.isInteger(Number(payload.decimal_places)))) throw new Error("Select a supported ISO 4217 currency and integer precision from 0 to 6.");
  if (id && !["sme_profiles", "currencies", "user_capabilities", "compensation_policy_versions"].includes(entity)) payload.id = id;
  return payload;
}
