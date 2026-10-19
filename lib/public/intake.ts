// Public interest intake (sponsor, SME, school/institution, country, contact).
//
// OPEN since 18 October 2026 (owner-approved: docs/proposals/public-intake-contract.md, migration 20261018150000_public_interest_intake). History: no governed
// anonymous submission destination existed before, because:
// - public.support_tickets has no category/kind column and its insert policy is named for
//   authenticated requesters; using it for anonymous marketing leads would be an unreviewed
//   security decision.
// - public.market_change_requests and sponsor/SME/institution tables require an authenticated user.
// Forms therefore render disabled ("Expression of interest form coming soon") and never claim
// success. PUBLIC_INTAKE_CONTRACT_PROPOSED: docs/proposals/public-intake-contract.md describes the
// single governed intake (one table, five categories, server-only writes) awaiting approval.

export type InterestKind = "sponsor" | "sme" | "school" | "country" | "contact";

export type IntakeStatus = "OPEN" | "STORAGE_REQUIRED";

export const INTAKE_STATUS: Record<InterestKind, IntakeStatus> = {
  sponsor: "OPEN",
  sme: "OPEN",
  school: "OPEN",
  country: "OPEN",
  contact: "OPEN",
};

export const SPONSOR_TYPES = [
  "Individual",
  "Old student / alumnus",
  "Alumni / old students' association",
  "Company / CSR",
  "Foundation",
  "NGO",
  "School / university / professional body",
  "Public institution",
  "Community / faith organization",
  "Development partner",
  "Other",
] as const;

export const INSTITUTION_TYPES = ["Public school", "Private school", "Group of schools", "Education office / authority", "Other organization"] as const;

export const ENQUIRY_TYPES = ["General enquiry", "Sponsor enquiry", "School / institution enquiry", "SME enquiry", "Account support"] as const;

export function isIntakeAvailable(kind: InterestKind): boolean {
  return INTAKE_STATUS[kind] !== "STORAGE_REQUIRED";
}
