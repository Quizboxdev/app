import { describe, expect, it } from "vitest";
import { GRADES, canonGrade, eligibleGrades, gradeLabel, gradeRank, stageOf } from "./grades";
import { MESSAGES, mockMessage } from "./messages";
import { PURPOSES, isWaecLabel, purposeLabel } from "./purposes";
import { linkCost, linkUrl, shortfall as linkShort, topupAmount as linkTopup } from "./links";
import { issueText, maxForRound, nextStep, recoveryOptions, roundHealth, roundMessage, stepText, tallyLines, type RoundState, type Totals } from "./tally";
import { mockExportFileName, parseMockExportRequest } from "./export-request";
import { EMPTY_FILTER, bandOf, filterParticipants, groupsOf, hardestFirst, isFiltered, percentLabel, stateLabel } from "./results-view";

const round = (o: Partial<RoundState> = {}): RoundState => ({ id: "r1", position: 1, grade_code: "B8", subject_code: "MATH", subject_label: "Mathematics", topic_id: "t1", topic_title: "Algebra", requested: 5, selected: 0, available: 9, available_to_add: 9, shortfall: 0, ...o });
const totals = (o: Partial<Totals> = {}): Totals => ({ desired: 12, allocated: 0, selected: 0, remaining_to_allocate: 12, remaining_to_select: 0, ...o });

describe("levels a cumulative exam may draw from (mirrors the database rule)", () => {
  it("allows the same stage up to the target year, and nothing else", () => {
    expect(eligibleGrades("B8")).toEqual(["B7", "B8"]);
    expect(eligibleGrades("B6")).toEqual(["B1", "B2", "B3", "B4", "B5", "B6"]);
    expect(eligibleGrades("SHS2")).toEqual(["SHS1", "SHS2"]);
    expect(eligibleGrades("B9")).not.toContain("B6");
    expect(eligibleGrades("nonsense")).toEqual([]);
  });
  it("treats B10 as SHS 1 and names the levels the way the rest of the app does", () => {
    expect(canonGrade(" b10 ")).toBe("SHS1"); expect(eligibleGrades("B10")).toEqual(["SHS1"]);
    expect(gradeLabel("B8")).toBe("JHS 2 (B8)"); expect(gradeLabel("B10")).toBe("SHS 1 (SHS1)"); expect(gradeLabel("")).toBe("-");
    expect(gradeRank("B1")).toBe(1); expect(gradeRank("SHS3")).toBe(12); expect(gradeRank("X")).toBeNull();
    expect(GRADES.map(stageOf)).toEqual(["PRIMARY", "PRIMARY", "PRIMARY", "PRIMARY", "PRIMARY", "PRIMARY", "JHS", "JHS", "JHS", "SHS", "SHS", "SHS"]);
  });
});

describe("the running tally", () => {
  it("says what each round's state is, and never suggests filling a short round from elsewhere", () => {
    expect(roundHealth(round())).toBe("empty");
    expect(roundHealth(round({ selected: 2, available_to_add: 3 }))).toBe("partial");
    expect(roundHealth(round({ selected: 5 }))).toBe("full");
    const short = round({ requested: 5, selected: 0, available: 2, available_to_add: 2, shortfall: 3 });
    expect(roundHealth(short)).toBe("short");
    expect(roundMessage(short)).toBe("Only 2 different approved questions are available in this topic, 3 short of the 5 you asked for.");
    expect(recoveryOptions(short)).toEqual(["lower_count", "other_topic", "add_questions"]);
    expect(recoveryOptions(round())).toEqual([]);
    expect(roundMessage(round({ requested: 3, selected: 1, available: 2, available_to_add: 1, shortfall: 1 }))).toMatch(/Only 2 different approved questions are available/);
    expect(roundMessage(round({ selected: 2, available_to_add: 7 }))).toBe("2 of 5 chosen. 7 more available to add.");
    expect(roundMessage(round({ selected: 5 }))).toBe("5 of 5 chosen.");
  });
  it("guides the author from an empty exam to review", () => {
    expect(nextStep(totals(), [])).toEqual({ code: "ADD_ROUND" });
    const a = round({ requested: 5 });
    expect(nextStep(totals({ allocated: 5, remaining_to_allocate: 7, remaining_to_select: 5 }), [a])).toEqual({ code: "ALLOCATE_MORE", count: 7 });
    expect(nextStep(totals({ allocated: 12, remaining_to_allocate: 0, remaining_to_select: 12 }), [a])).toEqual({ code: "PICK", round: 1, count: 5 });
    expect(nextStep(totals({ allocated: 12, remaining_to_allocate: 0 }), [round({ requested: 5, available_to_add: 2, shortfall: 3 })])).toEqual({ code: "FIX_SHORTFALL", round: 1, count: 3 });
    expect(nextStep(totals({ allocated: 5, selected: 5, remaining_to_allocate: 0 }), [round({ selected: 5 })])).toEqual({ code: "REVIEW" });
    expect(stepText({ code: "FIX_SHORTFALL", round: 2, count: 3 })).toMatch(/Round 2 is 3 short.*another topic/);
    expect(stepText({ code: "PICK", round: 1, count: 1 })).toBe("Choose 1 question for round 1.");
    expect(stepText({ code: "REVIEW" })).toMatch(/Review the exam/);
  });
  it("shows the five numbers and the most a round may ask for", () => {
    expect(tallyLines(totals({ allocated: 7, selected: 4, remaining_to_allocate: 5, remaining_to_select: 3 })).map((l) => [l.label, l.value])).toEqual([["Desired", 12], ["Allocated to rounds", 7], ["Chosen", 4], ["Still to allocate", 5], ["Still to choose", 3]]);
    expect(maxForRound(totals({ allocated: 7 }))).toBe(5);
    expect(maxForRound(totals({ allocated: 7 }), 4)).toBe(9);          // editing a round that already holds 4
    expect(maxForRound(totals({ allocated: 15 }))).toBe(0);
    expect(maxForRound(totals({ desired: 100, allocated: 0 }))).toBe(10);   // one topic gives at most 10, even when the exam has room for more
  });
  it("words every review code, with the right singular and plural", () => {
    expect(issueText({ code: "NOT_FULLY_ALLOCATED", count: 1 })).toBe("1 question is still to be allocated to a round.");
    expect(issueText({ code: "NOT_FULLY_ALLOCATED", count: 4 })).toBe("4 questions are still to be allocated to a round.");
    expect(issueText({ code: "ROUND_NOT_FILLED", round: 2, count: 3 })).toBe("Round 2 still needs 3 questions.");
    expect(issueText({ code: "QUESTION_UNAVAILABLE", count: 1 })).toMatch(/1 chosen question is no longer approved/);
    expect(issueText({ code: "NO_ROUNDS" })).toMatch(/at least one round/);
    expect(issueText({ code: "DUPLICATE_QUESTIONS", count: 2 })).toMatch(/2 chosen questions repeat/);
    expect(issueText({ code: "TOO_FEW_QUESTIONS", count: 3 })).toMatch(/minimum/);
    expect(issueText({ code: "SOMETHING_ELSE" })).toBe("Something needs attention.");
  });
});

describe("purposes", () => {
  it("labels BECE and WASSCE readiness as labels only, because no WAEC syllabus mapping exists", () => {
    expect(PURPOSES.map((p) => p.value)).toEqual(["practice", "promotion", "end_of_term", "bece_readiness", "wassce_readiness", "other"]);
    expect(isWaecLabel("bece_readiness")).toBe(true); expect(isWaecLabel("practice")).toBe(false);
    expect(PURPOSES.find((p) => p.value === "bece_readiness")!.hint).toMatch(/label only.*not from a WAEC syllabus/i);
    expect(purposeLabel("promotion")).toBe("Promotion exam"); expect(purposeLabel("zzz")).toBe("zzz");
  });
});

describe("error messages", () => {
  it("keeps a useful detail for the codes that carry one and hides everything else the database says", () => {
    expect(mockMessage("QB_TOPIC_SHORT: Algebra has 3 available, 5 needed")).toBe("This topic does not have enough different approved questions. Algebra has 3 available, 5 needed.");
    expect(mockMessage("QB_MOCK_OVER_ALLOCATED: 10 of 12 questions are already allocated, so at most 2 can be added")).toMatch(/at most 2 can be added\.$/);
    expect(mockMessage("QB_MOCK_NOT_READY: ROUND_NOT_FILLED")).toBe("The exam is not ready to publish yet. (round not filled)");
    expect(mockMessage("QB_MOCK_VERSION_STALE: 1 question(s) changed or were withdrawn since version 1 was published")).toMatch(/Build and publish the next version first\. 1 question/);
    expect(mockMessage('relation "public.secret" does not exist')).toBe("That did not work. Please try again.");
    expect(mockMessage(undefined)).toBe("That did not work. Please try again.");
    expect(mockMessage("QB_MOCK_ENTITLEMENT_REQUIRED")).toBe(MESSAGES.QB_MOCK_ENTITLEMENT_REQUIRED);
  });
  it("covers every error code the three migrations raise", async () => {
    const { readFileSync } = await import("node:fs");
    const raised = new Set<string>();
    for (const f of ["20261122100000_mock_exams_authoring", "20261122110000_mock_exams_delivery", "20261122120000_mock_exams_marketplace"])
      for (const m of readFileSync(new URL(`../../supabase/migrations/${f}.sql`, import.meta.url), "utf8").matchAll(/raise exception '(QB_[A-Z_]+)/g)) raised.add(m[1]);
    const internal = new Set(["QB_MOCK_VERSION_IMMUTABLE"]);          // raised by a trigger, never shown on a screen
    const missing = [...raised].filter((c) => !(c in MESSAGES) && !internal.has(c));
    expect(missing).toEqual([]);
  });
});

describe("export request", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  it("accepts ids and fixed words only", () => {
    expect(parseMockExportRequest({ examId: id, format: "xlsx", state: "submitted", classId: id })).toEqual({ ok: true, value: { examId: id, versionId: null, classId: id, studentId: null, questionId: null, state: "submitted", format: "xlsx" } });
    expect(parseMockExportRequest({ examId: id })).toMatchObject({ ok: true, value: { format: "csv", state: null } });
    for (const bad of [{}, { examId: "x" }, { examId: id, classId: "'; drop table x;--" }, { examId: id, state: "all" }, { examId: id, versionId: 7 }, null]) expect(parseMockExportRequest(bad).ok).toBe(false);
  });
  it("names the file after the exam and version", () => {
    expect(mockExportFileName("Mock exam results: JHS 2 BECE readiness mock (version 2)", "csv")).toBe("quizbox-mock-exam-jhs-2-bece-readiness-mock-v2-results.csv");
    expect(mockExportFileName("Mock exam results: ../../etc/passwd \"x\" (version 1)", "xlsx")).toBe("quizbox-mock-exam-etc-passwd-x-v1-results.xlsx");
    expect(mockExportFileName("something else", "csv")).toBe("quizbox-mock-exam-something-else-results.csv");
  });
});

describe("results view", () => {
  const rows = [{ participant: "Esi Student", group: "JHS 2 Gold", state: "submitted", percent: 100, attempt_no: 1 }, { participant: "Kwame Student", group: "JHS 2 Gold", state: "in_progress", percent: null, attempt_no: 1 },
    { participant: "Buyer 1", group: "Marketplace", state: "submitted", percent: 50, attempt_no: 1 }];
  it("filters by name, state and group", () => {
    expect(filterParticipants(rows, EMPTY_FILTER)).toHaveLength(3);
    expect(filterParticipants(rows, { query: " kwa ", state: "", group: "" }).map((r) => r.participant)).toEqual(["Kwame Student"]);
    expect(filterParticipants(rows, { query: "", state: "submitted", group: "Marketplace" }).map((r) => r.participant)).toEqual(["Buyer 1"]);
    expect(isFiltered(EMPTY_FILTER)).toBe(false); expect(isFiltered({ ...EMPTY_FILTER, state: "submitted" })).toBe(true);
    expect(groupsOf(rows)).toEqual(["JHS 2 Gold", "Marketplace"]);
  });
  it("words states and percentages and puts the hardest questions first", () => {
    expect(stateLabel("expired")).toBe("Time ran out"); expect(stateLabel("odd")).toBe("odd");
    expect(percentLabel(66.666)).toBe("66.7%"); expect(percentLabel(null)).toBe("-"); expect(percentLabel(NaN)).toBe("-");
    expect(hardestFirst([{ position: 1, correct_percent: 90 }, { position: 2, correct_percent: null }, { position: 3, correct_percent: 20 }]).map((q) => q.position)).toEqual([3, 1, 2]);
    expect([bandOf(10), bandOf(55), bandOf(95), bandOf(null)]).toEqual(["hard", "medium", "easy", "none"]);
  });
});

describe("shared links: places and Coins", () => {
  it("costs 1 Coin a place, charges only the difference when places are added, and asks for exactly what is missing", () => {
    expect(linkCost(50, 0)).toBe(50); expect(linkCost(80, 50)).toBe(30); expect(linkCost(50, 50)).toBe(0); expect(linkCost(10, 50)).toBe(0);
    expect(linkCost(10, 0, 2)).toBe(20);
    expect(linkShort(30, 12)).toBe(18); expect(linkShort(5, 12)).toBe(0);
    expect(linkTopup(0)).toBe(0); expect(linkTopup(3)).toBe(5); expect(linkTopup(18)).toBe(18);                      // the smallest online payment is 5 Coins
  });
  it("builds the address people open", () => { expect(linkUrl("https://www.quizbox.io/", "abc123def0")).toBe("https://www.quizbox.io/mock-exams/join/abc123def0"); });
});

