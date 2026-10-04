// Public interest intake (sponsor, SME, school/institution, country, contact).
//
// No governed anonymous submission destination exists in the current backend:
// - public.support_tickets has no category/kind column and its insert policy is named for
//   authenticated requesters; using it for anonymous marketing leads would be an unreviewed
//   security decision.
// - public.market_change_requests and sponsor/SME/institution tables require an authenticated user.
// Forms therefore render disabled ("Expression of interest form coming soon") and never claim
// success. PUBLIC_INTAKE_CONTRACT_PROPOSED: docs/proposals/public-intake-contract.md describes the
// single governed intake (one table, five categories, server-only writes) awaiting approval.

export type InterestKind = "sponsor" | "sme" | "school" | "country" | "contact";

export type IntakeStatus = "STORAGE_REQUIRED";

export const INTAKE_STATUS: Record<InterestKind, IntakeStatus> = {
  sponsor: "STORAGE_REQUIRED", // SPONSOR_INTEREST_STORAGE_REQUIRED
  sme: "STORAGE_REQUIRED", // SME_APPLICATION_STORAGE_REQUIRED (standalone, non-teacher applicants)
  school: "STORAGE_REQUIRED", // SCHOOL_INTEREST_STORAGE_REQUIRED
  country: "STORAGE_REQUIRED", // COUNTRY_INTEREST_STORAGE_REQUIRED
  contact: "STORAGE_REQUIRED", // CONTACT_SUBMISSION_STORAGE_REQUIRED
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
