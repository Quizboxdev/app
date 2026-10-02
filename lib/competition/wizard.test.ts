import { describe, expect, it } from "vitest";
import { newWizardConfig, resumeWizardConfig, wizardIssues } from "./wizard";
import { sponsorEngineEnabled } from "./local-gate";
describe("wizard persistence and local activation boundary", () => {
  it("preserves saved fields and step during resume", () => { const config = resumeWizardConfig({ title: "Challenge", step: 5, sourceIds: ["doc"], durationSeconds: 900 }); expect(config.title).toBe("Challenge"); expect(config.sourceIds).toEqual(["doc"]); expect(config.step).toBe(5); expect(config.durationSeconds).toBe(900); });
  it("bounds persisted step", () => expect(resumeWizardConfig({ step: 99 }).step).toBe(8));
  it("requires title and dates", () => expect(wizardIssues(newWizardConfig(), 0)).toHaveLength(2));
  it("requires explicit source selection", () => expect(wizardIssues(newWizardConfig(), 4)).toHaveLength(1));
  it("requires two markets for multi-market", () => { const c = newWizardConfig(); c.scope = "MULTI_MARKET"; c.marketIds = ["gh"]; expect(wizardIssues(c, 2)).toHaveLength(1); });
  it("requires valid difficulty distribution", () => { const c = newWizardConfig(); c.easy = 10; expect(wizardIssues(c, 5)).toContain("Difficulty percentages must total 100."); });
  it.each(["https://fmgccmqxfjppqydkhaiu.supabase.co", "https://staging.supabase.co", "invalid"])("refuses hosted activation at %s", url => expect(sponsorEngineEnabled({ QUIZBOX_SPONSOR_ENGINE_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: url })).toBe(false));
  it("requires explicit opt-in on loopback", () => { expect(sponsorEngineEnabled({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toBe(false); expect(sponsorEngineEnabled({ QUIZBOX_SPONSOR_ENGINE_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toBe(true); });
});
