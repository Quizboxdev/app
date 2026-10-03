import { describe, expect, it } from "vitest";
import { internationalSourceIssues, type GlobalSourcePack } from "./international";
const pack = (over: Partial<GlobalSourcePack> = {}): GlobalSourcePack => ({ id: "p1", title: "Pack", version: "1", checksum: "c", sourceKind: "HARMONIZED_PACK", validationStatus: "approved", approvedBy: "u", rightsConfirmed: true, subjects: ["Math"], ...over });
describe("international source contract", () => {
  it("requires sponsor sources or an approved global pack", () => expect(internationalSourceIssues({ scope: "GLOBAL", sourceMode: "SPONSOR_SOURCE", sponsorSourceIds: [], globalPackIds: [] }, [])).toEqual(["INTERNATIONAL_SOURCE_REQUIRED"]));
  it("accepts sponsor sources alone", () => expect(internationalSourceIssues({ scope: "GLOBAL", sourceMode: "SPONSOR_SOURCE", sponsorSourceIds: ["s"], globalPackIds: [] }, [])).toEqual([]));
  it("rejects unapproved or unknown packs", () => expect(internationalSourceIssues({ scope: "GLOBAL", sourceMode: "HYBRID", sponsorSourceIds: ["s"], globalPackIds: ["p1", "p2"] }, [pack({ validationStatus: "review" })])).toEqual(["GLOBAL_PACK_NOT_APPROVED:p1", "GLOBAL_PACK_NOT_APPROVED:p2"]));
  it("accepts an approved pack", () => expect(internationalSourceIssues({ scope: "GLOBAL", sourceMode: "HYBRID", sponsorSourceIds: [], globalPackIds: ["p1"] }, [pack()])).toEqual([]));
});
