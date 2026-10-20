import { describe, expect, it } from "vitest";
import { curriculumTrail, levelDisplayName, looksLikeCode, objectiveLabel, splitTopicsForTeacher, strandHint, topicLabel } from "./display";

describe("curriculum display labels", () => {
  it("recognises codes and bare level words, not wording", () => {
    for (const c of ["B5.1.2.3", "B9.1.1", "1.2.1.LI.1", "Strand", "Sub-strand", "Strand 2", "Unit 3", "", "  ", null, undefined]) expect(looksLikeCode(c as any)).toBe(true);
    for (const w of ["Fractions", "Living things and their environment", "Number operations"]) expect(looksLikeCode(w)).toBe(false);
  });

  it("shows the title, falls back to the indicator wording, and otherwise has nothing to show", () => {
    expect(topicLabel({ title: "Fractions", indicator: "Add fractions" })).toBe("Fractions");
    expect(topicLabel({ title: "B5.1.2", indicator: "Add fractions with like denominators" })).toBe("Add fractions with like denominators");
    expect(topicLabel({ title: "Sub-strand", indicator: "B5.1.2.3.1" })).toBeNull();
    expect(topicLabel({ title: "x ".repeat(80) }, 20)!.length).toBeLessThanOrEqual(20);
  });

  it("uses a strand only as a readable hint", () => {
    expect(strandHint("Number")).toBe("Number");
    expect(strandHint("Strand 1")).toBeNull();
    expect(strandHint(null)).toBeNull();
  });

  it("never puts a code in an objective menu or a trail", () => {
    expect(objectiveLabel({ title: "Identify the parts of a plant", code: "B5.2.1.1.1" })).toBe("Identify the parts of a plant");
    expect(objectiveLabel({ title: "B5.2.1.1.1", code: "B5.2.1.1.1" })).toBe("Objective");
    expect(curriculumTrail(["Living things", "Sub-strand", "B5.2.1.1.1", null, "Plants"])).toBe("Living things › Plants");
  });

  it("uses plain level names", () => {
    expect(levelDisplayName("strand")).toBe("Area");
    expect(levelDisplayName("sub_strand")).toBe("Topic area");
    expect(levelDisplayName("learning_indicator")).toBe("Objective");
    expect(levelDisplayName("unknown_level", "Cluster")).toBe("Cluster");
    expect(levelDisplayName("unknown_level", "B5.1")).toBe("Topic");
  });

  it("splits a class's topics: readable ones shown with an optional hint, unreadable ones reported, none called 'Other'", () => {
    const { shown, unlabelled } = splitTopicsForTeacher([
      { title: "Fractions", indicator: "x", strand: "Number" },
      { title: "Number", indicator: "x", strand: "Number" },
      { title: "B5.1.2", indicator: "Compare fractions", strand: "Strand 1" },
      { title: "Sub-strand", indicator: "B5.1.2.3", strand: null },
    ]);
    expect(shown.map((t) => [t.label, t.hint])).toEqual([["Fractions", "Number"], ["Number", null], ["Compare fractions", null]]);
    expect(unlabelled).toHaveLength(1);
  });
});
