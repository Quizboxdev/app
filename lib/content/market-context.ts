export type ContentScope = "local_market" | "selected_multi_market" | "global";
export type ContentSourceMode = "curriculum_aligned" | "sponsor_document" | "hybrid";
export type SourceCorpus = {
  id: string;
  kind: "curriculum" | "sponsor_document" | "harmonized_concept_pack";
  market_id: string | null;
  curriculum_id: string | null;
  authority_id: string | null;
  validation_status: string;
  active: boolean;
};
export type ContentContext = {
  scope: ContentScope;
  sourceMode: ContentSourceMode;
  marketIds: string[];
  sourceIds: string[];
};

export function validateContentContext(context: ContentContext, sources: SourceCorpus[], allowedMarkets: string[]): string[] {
  const issues: string[] = [];
  if (!["local_market", "selected_multi_market", "global"].includes(context.scope)) issues.push("INVALID_CONTENT_SCOPE");
  if (!["curriculum_aligned", "sponsor_document", "hybrid"].includes(context.sourceMode)) issues.push("INVALID_SOURCE_MODE");
  if (new Set(context.marketIds).size !== context.marketIds.length || new Set(context.sourceIds).size !== context.sourceIds.length) issues.push("DUPLICATE_CONTEXT_SELECTION");
  if (
    (context.scope === "local_market" && context.marketIds.length !== 1) ||
    (context.scope === "selected_multi_market" && context.marketIds.length < 2) ||
    (context.scope === "global" && context.marketIds.length !== 0)
  ) issues.push("INVALID_MARKET_SELECTION");
  if (context.marketIds.some(id => !allowedMarkets.includes(id))) issues.push("MARKET_ACCESS_DENIED");
  if (!context.sourceIds.length) issues.push("EXPLICIT_APPROVED_SOURCES_REQUIRED");
  const chosen = context.sourceIds.map(id => sources.find(source => source.id === id));
  if (new Set(sources.map(source => source.id)).size !== sources.length) issues.push("AMBIGUOUS_SOURCE_CATALOGUE");
  if (chosen.some(source => source && !["curriculum", "sponsor_document", "harmonized_concept_pack"].includes(source.kind))) issues.push("INVALID_SOURCE_KIND");
  if (chosen.some(source => !source || !source.active || source.validation_status !== "approved")) issues.push("UNAPPROVED_SOURCE_CORPUS");
  if (chosen.some(source => source?.kind === "curriculum" && (!source.curriculum_id || !source.authority_id || !source.market_id))) issues.push("NATIONAL_CURRICULUM_IDENTITY_REQUIRED");
  if (context.scope !== "global" && chosen.some(source => source?.market_id && !context.marketIds.includes(source.market_id))) issues.push("CROSS_MARKET_SOURCE_DENIED");
  if (chosen.some(source => source?.market_id && !allowedMarkets.includes(source.market_id))) issues.push("SOURCE_MARKET_ACCESS_DENIED");
  if (context.scope === "global" && chosen.some(source => source?.kind === "curriculum")) issues.push("GLOBAL_REQUIRES_DOCUMENTS_OR_HARMONIZED_PACKS");
  const hasCurriculum = chosen.some(source => source?.kind === "curriculum" || source?.kind === "harmonized_concept_pack");
  const hasDocument = chosen.some(source => source?.kind === "sponsor_document");
  if (
    (context.sourceMode === "curriculum_aligned" && (!hasCurriculum || hasDocument)) ||
    (context.sourceMode === "sponsor_document" && (!hasDocument || hasCurriculum)) ||
    (context.sourceMode === "hybrid" && (!hasCurriculum || !hasDocument))
  ) issues.push("SOURCE_MODE_MISMATCH");
  return [...new Set(issues)];
}

// Inputs must come from an authorized server catalogue, not browser assertions.
export function requireCurriculumContext(context: ContentContext, curriculumId: string, sources: SourceCorpus[], allowedMarkets: string[]) {
  const issues = validateContentContext(context, sources, allowedMarkets);
  if (issues.length) throw new Error(issues.join(", "));
  if (!context.sourceIds.some(id => sources.some(source => source.id === id && source.kind === "curriculum" && source.curriculum_id === curriculumId && source.validation_status === "approved" && source.active))) throw new Error("CURRICULUM_OUTSIDE_CONTENT_CONTEXT");
}
