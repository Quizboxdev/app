import { describe, expect, it } from "vitest";
import { newWizardConfig, resumeWizardConfig, wizardIssues } from "./wizard";
import { sponsorEngineEnabled } from "./local-gate";
describe("wizard persistence and local activation boundary", () => {
  it("preserves saved fields and step during resume", () => { const config = resumeWizardConfig({ title: "Challenge", step: 5, sourceIds: ["doc"], durationSeconds: 900 }); expect(config.title).toBe("Challenge"); expect(config.sourceIds).toEqual(["doc"]); expect(config.step).toBe(5); expect(config.durationSeconds).toBe(900); });
  it("defaults to a publishable engine configuration and normalizes unsupported saved settings", () => {
    expect(newWizardConfig()).toMatchObject({ randomizeQuestions: false, randomizeAnswers: false, negativeMarking: 0 });
    expect(resumeWizardConfig({ title: "Old", randomizeQuestions: true, randomizeAnswers: true })).toMatchObject({ title: "Old", randomizeQuestions: false, randomizeAnswers: false });
  });
  it("validates scheduled visibility against registration", () => {
    const c = { ...newWizardConfig(), title: "T", registrationOpensAt: "2030-01-02T00:00", registrationClosesAt: "2030-01-03T00:00", startsAt: "2030-01-03T00:00", endsAt: "2030-01-04T00:00" };
    expect(wizardIssues({ ...c, publishAt: "2030-01-01T00:00" }, 0)).toEqual([]);
    expect(wizardIssues({ ...c, publishAt: "2030-01-05T00:00" }, 0)).toContain("The visible-from time must be on or before registration opens.");
  });
  it("bounds persisted step", () => expect(resumeWizardConfig({ step: 99 }).step).toBe(8));
  it("requires title and dates", () => expect(wizardIssues(newWizardConfig(), 0)).toHaveLength(2));
  it("requires explicit source selection", () => expect(wizardIssues(newWizardConfig(), 4)).toHaveLength(1));
  it("requires two markets for multi-market", () => { const c = newWizardConfig(); c.scope = "MULTI_MARKET"; c.marketIds = ["gh"]; expect(wizardIssues(c, 2)).toHaveLength(1); });
  it("requires valid difficulty distribution", () => { const c = newWizardConfig(); c.easy = 10; expect(wizardIssues(c, 5)).toContain("Difficulty percentages must total 100."); });
  it.each(["https://fmgccmqxfjppqydkhaiu.supabase.co", "https://staging.supabase.co", "invalid"])("refuses hosted activation at %s", url => expect(sponsorEngineEnabled({ QUIZBOX_SPONSOR_ENGINE_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: url })).toBe(false));
  it("allows only the explicitly named preview branch", () => {
    const on = { QUIZBOX_SPONSOR_ENGINE_ENABLED: "true", QUIZBOX_SPONSOR_BRANCH_REF: "fngdtxayfoiffbcbmcum" };
    expect(sponsorEngineEnabled({ ...on, NEXT_PUBLIC_SUPABASE_URL: "https://fngdtxayfoiffbcbmcum.supabase.co" })).toBe(true);
    expect(sponsorEngineEnabled({ ...on, NEXT_PUBLIC_SUPABASE_URL: "https://otherbranchrefxxxxxxx.supabase.co" })).toBe(false);
    expect(sponsorEngineEnabled({ ...on, NEXT_PUBLIC_SUPABASE_URL: "http://fngdtxayfoiffbcbmcum.supabase.co" })).toBe(false);
    expect(sponsorEngineEnabled({ ...on, QUIZBOX_SPONSOR_BRANCH_REF: "fmgccmqxfjppqydkhaiu", NEXT_PUBLIC_SUPABASE_URL: "https://fmgccmqxfjppqydkhaiu.supabase.co" })).toBe(false);
    expect(sponsorEngineEnabled({ ...on, QB_PRODUCTION_PROJECT_REF: "fngdtxayfoiffbcbmcum", NEXT_PUBLIC_SUPABASE_URL: "https://fngdtxayfoiffbcbmcum.supabase.co" })).toBe(false);
  });
  it("requires explicit opt-in on loopback", () => { expect(sponsorEngineEnabled({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toBe(false); expect(sponsorEngineEnabled({ QUIZBOX_SPONSOR_ENGINE_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toBe(true); });
});
