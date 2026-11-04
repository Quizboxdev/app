import { describe, expect, it } from "vitest";
import { breakdownBand, canCombineSubjects, classLevel, sectionProblems, sectionsFromLegacyDraft, splitEvenly, toApiSections, totalOf, type SectionDraft } from "./blueprint";

const sec = (over: Partial<SectionDraft> = {}): SectionDraft => ({ subject: "Mathematics", mode: "any", topicIds: [], quota: 10, ...over });

describe("which classes may combine subjects", () => {
  it("reads the level from the class's grade code, as the database does", () => {
    expect(["B1", "b6", "B7", "B9", "B10", "SHS1", "SHS 3", "X1"].map((g) => classLevel(g))).toEqual(["PRIMARY", "PRIMARY", "JHS", "JHS", "SHS", "SHS", "SHS", "OTHER"]);
    expect(classLevel("", "Primary School")).toBe("PRIMARY");
    expect(classLevel(null, "Junior High")).toBe("JHS");
    expect(classLevel("X1", "Adult education")).toBe("OTHER");
  });
  it("allows Primary and JHS only", () => {
    expect((["PRIMARY", "JHS", "SHS", "OTHER"] as const).map(canCombineSubjects)).toEqual([true, true, false, false]);
  });
});

describe("sharing a total", () => {
  it("spreads evenly, the first sections taking the remainder, and never leaves a section empty", () => {
    expect(splitEvenly(20, 3)).toEqual([7, 7, 6]);
    expect(splitEvenly(9, 3)).toEqual([3, 3, 3]);
    expect(splitEvenly(2, 4)).toEqual([1, 1, 1, 1]);
    expect(splitEvenly(10, 0)).toEqual([]);
    expect(totalOf(splitEvenly(37, 5).map((quota) => ({ quota })))).toBe(37);
  });
});

describe("what is sent to the database", () => {
  it("names topics only for a section with ticked topics, and difficulty only when set", () => {
    expect(toApiSections([sec({ mode: "pick", topicIds: ["t1", "t2"], quota: 8, difficulty: "hard" }), sec({ subject: "Science", quota: 5 })])).toEqual([
      { subject: "Mathematics", quota: 8, topic_ids: ["t1", "t2"], difficulty: "hard" }, { subject: "Science", quota: 5 }]);
  });
});

describe("what the teacher still has to fix", () => {
  it("accepts a complete test", () => expect(sectionProblems([sec(), sec({ subject: "Science", mode: "pick", topicIds: ["a"], quota: 4 })], "JHS")).toEqual([]));
  it("holds a Senior High or unknown class to one subject", () => {
    expect(sectionProblems([sec(), sec({ subject: "Science" })], "SHS")).toEqual(["A test with more than one subject is for Primary and JHS classes."]);
    expect(sectionProblems([sec()], "SHS")).toEqual([]);
    expect(sectionProblems([sec(), sec({ subject: "Science" })], "OTHER")).toHaveLength(1);
  });
  it("names each subject with a problem, in plain words", () => {
    expect(sectionProblems([], "PRIMARY")).toEqual(["Choose at least one subject."]);
    expect(sectionProblems([sec({ quota: 0 })], "PRIMARY")).toEqual(["Mathematics: choose how many questions."]);
    expect(sectionProblems([sec({ mode: "pick" })], "PRIMARY")).toEqual(["Mathematics: tick at least one topic, or choose any topic."]);
    expect(sectionProblems([sec({ mode: "pick", topicIds: ["a", "b", "c"], quota: 2 })], "PRIMARY")).toEqual(["Mathematics: 3 topics need at least 3 questions."]);
    expect(sectionProblems([sec({ quota: 60 }), sec({ subject: "Science", quota: 50 })], "PRIMARY")).toEqual(["A test can have at most 100 questions in all."]);
  });
});

describe("a draft saved before sections existed", () => {
  it("becomes one section", () => {
    expect(sectionsFromLegacyDraft({ subject: "Science", chosen: ["a", "b"], total: 12 })).toEqual([{ subject: "Science", mode: "pick", topicIds: ["a", "b"], quota: 12 }]);
    expect(sectionsFromLegacyDraft({ subject: "Science", chosen: [], total: 12 })[0].mode).toBe("any");
    expect(sectionsFromLegacyDraft({})).toEqual([]);
  });
});

describe("how a score is described to a learner", () => {
  it("uses the same 68% line as the result page's area to work on", () => {
    expect([100, 85, 84, 68, 67, 0].map((p) => breakdownBand(p).key)).toEqual(["strong", "strong", "getting-there", "getting-there", "needs-work", "needs-work"]);
    expect(breakdownBand(40).label).toBe("Needs more practice");
  });
});
