import { describe, expect, it } from "vitest";
import { stageBlock } from "./stage-block";
import type { StageProgress } from "@/lib/challenges/types";

const stage = (over: Partial<StageProgress>): StageProgress => ({ stage_no: 1, title: "Round 1", question_count: 10, time_limit_seconds: 600, pass_percent: 0, state: "OPEN", attempts_used: 0, attempts_allowed: 1, best_score: null, best_max: null, ...over } as StageProgress);

describe("why Start is off", () => {
  it("says nothing for an open round or before the rounds have loaded", () => { expect(stageBlock(stage({}), "challenge")).toBeNull(); expect(stageBlock(undefined, "challenge")).toBeNull(); });
  it("explains a completed one-attempt challenge and shows the best score", () => {
    expect(stageBlock(stage({ state: "USED", attempts_used: 1, attempts_allowed: 1, best_score: 7, best_max: 10 }), "challenge")).toBe("You have already completed this challenge (1 of 1 attempt used). Your best score was 7 out of 10.");
  });
  it("pluralises attempts and works without a score", () => { expect(stageBlock(stage({ state: "USED", attempts_used: 3, attempts_allowed: 3 }), "competition")).toBe("You have already completed this competition (3 of 3 attempts used)."); });
  it("gives a reason for every other state", () => {
    for (const state of ["CLOSED", "NOT_OPEN", "NOT_THROUGH", "WAITING", "LOCKED"] as const) expect(stageBlock(stage({ state }), "challenge")).toMatch(/\w/);
  });
});
