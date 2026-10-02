import { describe, expect, it } from "vitest";
import { ContentContext, requireCurriculumContext, SourceCorpus, validateContentContext } from "./market-context";

const source = (id: string, kind: SourceCorpus["kind"], market: string | null, curriculum: string | null): SourceCorpus => ({ id, kind, market_id: market, curriculum_id: curriculum, authority_id: curriculum ? `authority-${market}` : null, validation_status: "approved", active: true });
const sources = [source("national-a", "curriculum", "a", "curriculum-a"), source("national-b", "curriculum", "b", "curriculum-b"), source("document-a", "sponsor_document", "a", null), source("pack", "harmonized_concept_pack", null, null)];
const local: ContentContext = { scope: "local_market", sourceMode: "curriculum_aligned", marketIds: ["a"], sourceIds: ["national-a"] };

describe("country-neutral content governance", () => {
  it("requires an explicit local market and approved corpus", () => {
    expect(validateContentContext(local, sources, ["a"])).toEqual([]);
    expect(validateContentContext({ ...local, marketIds: [] }, sources, ["a"])).toContain("INVALID_MARKET_SELECTION");
    expect(validateContentContext({ ...local, sourceIds: [] }, sources, ["a"])).toContain("EXPLICIT_APPROVED_SOURCES_REQUIRED");
  });
  it("does not expose another country's curriculum in the default local context", () => {
    expect(validateContentContext({ ...local, sourceIds: ["national-b"] }, sources, ["a", "b"])).toContain("CROSS_MARKET_SOURCE_DENIED");
    expect(() => requireCurriculumContext(local, "curriculum-b", sources, ["a"])).toThrow("CURRICULUM_OUTSIDE_CONTENT_CONTEXT");
  });
  it("requires exact authority and national curriculum identity", () => {
    expect(validateContentContext(local, [{ ...sources[0], authority_id: null }], ["a"])).toContain("NATIONAL_CURRICULUM_IDENTITY_REQUIRED");
  });
  it.each(["review", "rejected"])("never uses a %s corpus", status => {
    expect(validateContentContext(local, [{ ...sources[0], validation_status: status }], ["a"])).toContain("UNAPPROVED_SOURCE_CORPUS");
  });
  it("supports sponsor documents and requires both source families for hybrid", () => {
    expect(validateContentContext({ ...local, sourceMode: "sponsor_document", sourceIds: ["document-a"] }, sources, ["a"])).toEqual([]);
    expect(validateContentContext({ ...local, sourceMode: "hybrid", sourceIds: ["document-a", "national-a"] }, sources, ["a"])).toEqual([]);
    expect(validateContentContext({ ...local, sourceMode: "hybrid" }, sources, ["a"])).toContain("SOURCE_MODE_MISMATCH");
  });
  it("requires an explicit authorized multi-market selection", () => {
    const context: ContentContext = { scope: "selected_multi_market", sourceMode: "curriculum_aligned", marketIds: ["a", "b"], sourceIds: ["national-a", "national-b"] };
    expect(validateContentContext(context, sources, ["a", "b"])).toEqual([]);
    expect(validateContentContext(context, sources, ["a"])).toContain("MARKET_ACCESS_DENIED");
  });
  it("never treats global scope as an automatic national-curriculum union", () => {
    const context: ContentContext = { scope: "global", sourceMode: "curriculum_aligned", marketIds: [], sourceIds: [] };
    expect(validateContentContext(context, sources, ["a", "b"])).toContain("EXPLICIT_APPROVED_SOURCES_REQUIRED");
    expect(validateContentContext({ ...context, sourceIds: ["pack"] }, sources, [])).toEqual([]);
    expect(validateContentContext({ ...context, sourceIds: ["national-a", "national-b"] }, sources, ["a", "b"])).toContain("GLOBAL_REQUIRES_DOCUMENTS_OR_HARMONIZED_PACKS");
  });
  it("preserves independent national identities without mutating input taxonomy", () => {
    const before = JSON.stringify(sources);
    requireCurriculumContext(local, "curriculum-a", sources, ["a"]);
    validateContentContext(local, sources, ["a"]);
    expect(JSON.stringify(sources)).toBe(before);
  });
  it("cannot use the curriculum guard to bypass market or source-mode validation", () => {
    expect(() => requireCurriculumContext({ ...local, sourceIds: ["national-b"] }, "curriculum-b", sources, ["a", "b"])).toThrow("CROSS_MARKET_SOURCE_DENIED");
    expect(() => requireCurriculumContext(local, "curriculum-a", sources, [])).toThrow("MARKET_ACCESS_DENIED");
    expect(() => requireCurriculumContext({ ...local, sourceMode: "sponsor_document" }, "curriculum-a", sources, ["a"])).toThrow("SOURCE_MODE_MISMATCH");
  });
  it("rejects duplicate selections and ambiguous source catalogues", () => {
    expect(validateContentContext({ ...local, sourceIds: ["national-a", "national-a"] }, sources, ["a"])).toContain("DUPLICATE_CONTEXT_SELECTION");
    expect(validateContentContext(local, [...sources, sources[0]], ["a"])).toContain("AMBIGUOUS_SOURCE_CATALOGUE");
  });
  it("does not treat a selected concept pack as permission to browse all national curricula", () => {
    expect(() => requireCurriculumContext({ scope: "global", sourceMode: "curriculum_aligned", marketIds: [], sourceIds: ["pack"] }, "curriculum-a", sources, ["a"])).toThrow("CURRICULUM_OUTSIDE_CONTENT_CONTEXT");
  });
  it("denies missing or inactive sources", () => {
    expect(validateContentContext({ ...local, sourceIds: ["missing"] }, sources, ["a"])).toContain("UNAPPROVED_SOURCE_CORPUS");
    expect(validateContentContext(local, [{ ...sources[0], active: false }], ["a"])).toContain("UNAPPROVED_SOURCE_CORPUS");
  });
});
