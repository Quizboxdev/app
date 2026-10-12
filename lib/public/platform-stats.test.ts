import { describe, expect, it } from "vitest";
import { toPublicPlatformStats } from "./platform-stats";

const good = {
  learners: { total: 5, primary: 2, jhs: 2, shs: 1 }, questions: { total: 9, primary: 4, jhs: 3, shs: 1 }, indicators: { total: "4000", primary: 1825, jhs: 1302, shs: 873 },
  people: { teachers: 4, reviewers: 2, schools: 1, sponsors: 2, markets: 1 }, as_of: "2026-10-12T10:00:00Z",
};

describe("public platform stats contract", () => {
  it("accepts the counts the database returns, including numeric strings", () => {
    expect(toPublicPlatformStats(good)).toMatchObject({ learners: { primary: 2, jhs: 2, shs: 1 }, indicators: { total: 4000 }, people: { reviewers: 2 }, asOf: "2026-10-12T10:00:00Z" });
  });
  it("returns null for anything malformed, so the page never shows a made-up number", () => {
    for (const bad of [null, undefined, "x", [], {}, { ...good, learners: { total: 1, primary: -1, jhs: 0, shs: 0 } }, { ...good, people: { ...good.people, teachers: null } },
      { ...good, questions: { total: 1.5, primary: 0, jhs: 0, shs: 0 } }, { ...good, indicators: { total: "many", primary: 0, jhs: 0, shs: 0 } }])
      expect(toPublicPlatformStats(bad)).toBeNull();
  });
});
