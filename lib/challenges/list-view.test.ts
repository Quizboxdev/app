import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, isFiltered, statusesIn, viewRows } from "./list-view";

const r = (title: string, status: string, participants: number, question_count: number, created_at: string) => ({ title, status, participants, question_count, created_at }) as any;
const rows = [r("Maths Sprint", "LIVE", 40, 10, "2026-11-01T00:00:00Z"), r("Écoute et réponds", "DRAFT", 0, 5, "2026-11-10T00:00:00Z"), r("Science Quiz", "COMPLETED", 120, 20, "2026-10-01T00:00:00Z")];

describe("challenge list view", () => {
  it("shows the newest first by default", () => { expect(viewRows(rows, DEFAULT_VIEW).map((x) => x.title)).toEqual(["Écoute et réponds", "Maths Sprint", "Science Quiz"]); });
  it("searches the title ignoring case and accents", () => {
    expect(viewRows(rows, { ...DEFAULT_VIEW, query: "ecoute" }).map((x) => x.title)).toEqual(["Écoute et réponds"]);
    expect(viewRows(rows, { ...DEFAULT_VIEW, query: "QUIZ" }).map((x) => x.title)).toEqual(["Science Quiz"]);
  });
  it("filters by status and sorts by played, either way", () => {
    expect(viewRows(rows, { ...DEFAULT_VIEW, status: "LIVE" })).toHaveLength(1);
    expect(viewRows(rows, { ...DEFAULT_VIEW, sort: "played" }).map((x) => x.participants)).toEqual([120, 40, 0]);
    expect(viewRows(rows, { ...DEFAULT_VIEW, sort: "title", dir: "asc" }).map((x) => x.title)[0]).toBe("Écoute et réponds");
  });
  it("lists the statuses present and knows when a filter is on", () => {
    expect(statusesIn(rows)).toEqual(["COMPLETED", "DRAFT", "LIVE"]);
    expect(isFiltered(DEFAULT_VIEW)).toBe(false);
    expect(isFiltered({ ...DEFAULT_VIEW, query: " x " })).toBe(true);
  });
  it("does not change the list it is given", () => { const copy = [...rows]; viewRows(rows, { ...DEFAULT_VIEW, sort: "title" }); expect(rows).toEqual(copy); });
});
