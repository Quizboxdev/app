// Contracts reserved for future international competitions. No harmonization engine exists yet:
// international content uses sponsor sources or an explicitly approved global source pack only.
// Storage maps onto existing structures: a global source pack is a source_documents row with
// source_kind = 'HARMONIZED_PACK'; concept mappings use harmonized_concept_mappings (approved flag).

export type GlobalSourcePack = {
  id: string; title: string; version: string; checksum: string;
  sourceKind: "HARMONIZED_PACK"; validationStatus: "review" | "approved" | "rejected"; approvedBy: string | null;
  rightsConfirmed: boolean; subjects: string[];
};
export type HarmonizedConcept = { key: string; title: string; subject: string; description: string };
export type MarketConceptMapping = {
  sourceDocumentId: string; conceptKey: string; marketId: string; curriculumNodeId: string;
  approved: boolean; approvedBy: string | null;
};

export type InternationalSourcePlan = { scope: "GLOBAL"; sourceMode: "SPONSOR_SOURCE" | "HYBRID"; sponsorSourceIds: string[]; globalPackIds: string[] };

// International competitions never draw on national curricula implicitly.
export function internationalSourceIssues(plan: InternationalSourcePlan, packs: GlobalSourcePack[]): string[] {
  const issues: string[] = [];
  if (!plan.sponsorSourceIds.length && !plan.globalPackIds.length) issues.push("INTERNATIONAL_SOURCE_REQUIRED");
  for (const id of plan.globalPackIds) {
    const pack = packs.find(p => p.id === id);
    if (!pack || pack.sourceKind !== "HARMONIZED_PACK" || pack.validationStatus !== "approved" || !pack.approvedBy || !pack.rightsConfirmed) issues.push(`GLOBAL_PACK_NOT_APPROVED:${id}`);
  }
  return issues;
}
