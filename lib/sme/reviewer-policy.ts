import policyFile from "../../config/reviewer-policy.json";

// The reviewer policy lives in config/reviewer-policy.json so it can be revised as a file. This module validates the file's shape
// and exposes it to the /review/policy page; a malformed file fails the tests (and shows an error) rather than rendering half a policy.
export type PolicyRule = { id: string; text: string; value?: string | number | null; unit?: string; status?: "default" | "owner_set" | "proposed" };
export type PolicySection = { id: string; title: string; summary: string; rules: PolicyRule[] };
export type ReviewerPolicy = { version: string; status: "PROPOSED" | "APPROVED"; updated: string; owner: string; how_to_revise: string; sections: PolicySection[] };

export function parseReviewerPolicy(raw: unknown): ReviewerPolicy {
  const p = raw as Partial<ReviewerPolicy> | null;
  const fail = (why: string): never => { throw new Error(`REVIEWER_POLICY_INVALID: ${why}`); };
  if (!p || typeof p !== "object") return fail("not an object");
  if (!/^\d+\.\d+\.\d+$/.test(String(p.version))) fail("version must be x.y.z");
  if (p.status !== "PROPOSED" && p.status !== "APPROVED") fail("status must be PROPOSED or APPROVED");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.updated))) fail("updated must be YYYY-MM-DD");
  if (!Array.isArray(p.sections) || p.sections.length === 0) fail("sections required");
  const ids = new Set<string>();
  for (const s of p.sections ?? []) {
    if (!s.id || !s.title || !Array.isArray(s.rules) || s.rules.length === 0) fail(`section ${s?.id ?? "?"} incomplete`);
    for (const r of s.rules) {
      const key = `${s.id}.${r.id}`;
      if (!r.id || !r.text) fail(`rule ${key} incomplete`);
      if (ids.has(key)) fail(`duplicate rule ${key}`);
      ids.add(key);
    }
  }
  return p as ReviewerPolicy;
}

export const reviewerPolicy = (): ReviewerPolicy => parseReviewerPolicy(policyFile);
// A value the owner still has to enter is shown as "Not set", never as a made-up number.
export const displayValue = (r: PolicyRule): string | null =>
  r.value === undefined ? null : r.value === null ? "Not set (owner decision)" : `${r.value}${r.unit && typeof r.value === "number" ? ` ${r.unit}` : ""}`;
