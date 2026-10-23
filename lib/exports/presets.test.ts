import { describe, expect, it } from "vitest";
import { PRESETS } from "./presets";

const on = (id: string, today: string) => PRESETS.find((p) => p.id === id)!.range(new Date(`${today}T15:00:00Z`));

describe("export date presets", () => {
  it("covers today, the last 7 and 30 days (including today)", () => {
    expect(on("today", "2026-10-23")).toEqual({ from: "2026-10-23", to: "2026-10-23" });
    expect(on("7d", "2026-10-23")).toEqual({ from: "2026-10-17", to: "2026-10-23" });
    expect(on("30d", "2026-10-23")).toEqual({ from: "2026-09-24", to: "2026-10-23" });
  });
  it("covers this month, last month (also across a year end), this quarter and this year", () => {
    expect(on("month", "2026-10-23")).toEqual({ from: "2026-10-01", to: "2026-10-23" });
    expect(on("last-month", "2026-10-23")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(on("last-month", "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(on("last-month", "2026-03-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(on("quarter", "2026-10-23")).toEqual({ from: "2026-10-01", to: "2026-10-23" });
    expect(on("quarter", "2026-05-02")).toEqual({ from: "2026-04-01", to: "2026-05-02" });
    expect(on("ytd", "2026-10-23")).toEqual({ from: "2026-01-01", to: "2026-10-23" });
  });
  it("last 12 months is a full year ending today, and all time has no bounds", () => {
    expect(on("12m", "2026-10-23")).toEqual({ from: "2025-10-24", to: "2026-10-23" });
    expect(on("all", "2026-10-23")).toEqual({ from: null, to: null });
  });
});
