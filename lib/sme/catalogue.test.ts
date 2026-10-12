import { describe, expect, it } from "vitest";
import { cascadeOptions, gradeSort, levelSort, type Catalogue } from "./catalogue";

const GH = "m-gh", NG = "m-ng";
const catalogue: Catalogue = {
  markets: [{ id: GH, name: "Ghana" }, { id: NG, name: "Nigeria" }],
  items: [
    { market_id: GH, level: "Primary", grade: "B4", subject: "Computing" }, { market_id: GH, level: "Primary", grade: "B5", subject: "Computing" },
    { market_id: GH, level: "Primary", grade: "B4", subject: "Creative Arts" }, { market_id: GH, level: "Primary", grade: "B6", subject: "History" },
    { market_id: GH, level: "JHS", grade: "B7", subject: "Mathematics" }, { market_id: GH, level: "JHS", grade: "B10", subject: "Science" },
    { market_id: GH, level: "SHS", grade: "SHS1", subject: "Biology" }, { market_id: NG, level: "JSS", grade: "JSS1", subject: "Basic Science" },
  ],
};

describe("curriculum pool cascade", () => {
  it("offers only the levels of the chosen market, in teaching order", () => {
    expect(cascadeOptions(catalogue, { market: GH }).levels).toEqual(["Primary", "JHS", "SHS"]);
    expect(cascadeOptions(catalogue, { market: NG }).levels).toEqual(["JSS"]);
    expect(cascadeOptions(catalogue, {}).levels).toEqual(["Primary", "JHS", "SHS", "JSS"]);
  });
  it("narrows grades by level and subjects by level and ticked grades", () => {
    expect(cascadeOptions(catalogue, { market: GH, level: "Primary" })).toMatchObject({ grades: ["B4", "B5", "B6"], subjects: ["Computing", "Creative Arts", "History"] });
    expect(cascadeOptions(catalogue, { market: GH, level: "Primary", grades: ["B5"] }).subjects).toEqual(["Computing"]);
    expect(cascadeOptions(catalogue, { market: GH, level: "Primary", grades: ["B4", "B6"] }).subjects).toEqual(["Computing", "Creative Arts", "History"]);
  });
  it("ignores a ticked grade that the level does not have, and never leaks another level's subjects", () => {
    expect(cascadeOptions(catalogue, { market: GH, level: "JHS", grades: ["B4"] }).subjects).toEqual(["Mathematics", "Science"]);
    expect(cascadeOptions(catalogue, { market: GH, level: "JHS" }).subjects).not.toContain("Computing");
  });
  it("sorts grades numerically (B10 after B9, SHS after B grades)", () => {
    expect(["SHS2", "B10", "B4", "SHS1", "B9"].sort(gradeSort)).toEqual(["B4", "B9", "B10", "SHS1", "SHS2"]);
    expect(["SHS", "JHS", "Primary"].sort(levelSort)).toEqual(["Primary", "JHS", "SHS"]);
  });
});
