import { describe, expect, it } from "vitest";
import { curriculumTrail, levelDisplayName, looksLikeCode, niceTitle, objectiveLabel, splitTopicsForTeacher, topicLabel, topicsInsteadOfStrands } from "./display";

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

  it("shows capital-letter topic names in title case, and leaves anything already mixed-case alone", () => {
    expect(niceTitle("HEAT")).toBe("Heat");
    expect(niceTitle("ELECTRICITY AND ELECTRONICS")).toBe("Electricity and Electronics");
    expect(niceTitle("INTRODUCTION TO MS-WINDOWS INTERFACE")).toBe("Introduction to MS-Windows Interface");
    expect(niceTitle("ICT IN THE SOCIETY")).toBe("ICT in the Society");
    expect(niceTitle("Living things")).toBe("Living things");
    expect(niceTitle("ICTs in the society")).toBe("ICTs in the society");
    expect(niceTitle(null)).toBe("");
    expect(topicLabel({ title: "WAVES" })).toBe("Waves");
  });

  it("never puts a code in an objective menu or a trail", () => {
    expect(objectiveLabel({ title: "Identify the parts of a plant", code: "B5.2.1.1.1" })).toBe("Identify the parts of a plant");
    expect(objectiveLabel({ title: "B5.2.1.1.1", code: "B5.2.1.1.1" })).toBe("Objective");
    expect(curriculumTrail(["Living things", "Sub-strand", "B5.2.1.1.1", null, "Plants"])).toBe("Living things › Plants");
    expect(curriculumTrail(["HEAT"])).toBe("Heat");
  });

  it("uses plain level names", () => {
    expect(levelDisplayName("strand")).toBe("Area");
    expect(levelDisplayName("sub_strand")).toBe("Topic");
    expect(levelDisplayName("learning_indicator")).toBe("Objective");
    expect(levelDisplayName("unknown_level", "Cluster")).toBe("Cluster");
    expect(levelDisplayName("unknown_level", "B5.1")).toBe("Topic");
  });

  it("splits a class's topics: readable ones shown by name only (no strand is offered), unreadable ones reported, none called 'Other'", () => {
    const { shown, unlabelled } = splitTopicsForTeacher([
      { title: "Fractions", indicator: "x", strand: "Number" },
      { title: "HEAT", indicator: "x", strand: "ENERGY" },
      { title: "B5.1.2", indicator: "Compare fractions", strand: "Strand 1" },
      { title: "Sub-strand", indicator: "B5.1.2.3", strand: null },
    ]);
    expect(shown.map((t) => t.label)).toEqual(["Fractions", "Heat", "Compare fractions"]);
    expect(shown.every((t) => !("hint" in t))).toBe(true);
    expect(unlabelled).toHaveLength(1);
  });

  it("lists the topics inside each strand instead of the strand, keeping the strand only as a hidden link", () => {
    const strandA = { id: "s1", node_type: "strand", title: "ENERGY" }, strandB = { id: "s2", node_type: "strand", title: "EMPTY" }, other = { id: "x", node_type: "sub_strand", title: "Direct topic" };
    const kids: Record<string, Array<{ id: string; node_type: string; title: string }>> = { s1: [{ id: "t1", node_type: "sub_strand", title: "HEAT" }, { id: "t2", node_type: "sub_strand", title: "WAVES" }], s2: [] };
    const out = topicsInsteadOfStrands([strandA, strandB, other], (s) => kids[s.id] ?? []);
    expect(out.map((n) => n.title)).toEqual(["HEAT", "WAVES", "EMPTY", "Direct topic"]);
    expect(out[0].via).toBe(strandA);
    expect(out[2].via).toBeUndefined();
    expect(out.filter((n) => n.node_type === "strand" && n.id === "s1")).toHaveLength(0);
  });
});
