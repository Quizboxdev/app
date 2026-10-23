import { describe, expect, it } from "vitest";
import { isRealDay, nextDayStart, parseExportRequest } from "./request";

describe("export request", () => {
  it("accepts a dataset, a range and a format, and defaults to CSV", () => {
    expect(parseExportRequest({ dataset: "payments", from: "2026-10-01", to: "2026-10-23", category: "successful", format: "xlsx" })).toEqual({ ok: true, value: { dataset: "payments", from: "2026-10-01", to: "2026-10-23", category: "successful", format: "xlsx" } });
    expect(parseExportRequest({ dataset: "mk_sales" })).toEqual({ ok: true, value: { dataset: "mk_sales", from: null, to: null, category: null, format: "csv" } });
    expect(parseExportRequest({ dataset: "users", format: "anything" })).toMatchObject({ ok: true, value: { format: "csv" } });
  });
  it("refuses a missing or odd dataset name, impossible dates and a backwards range", () => {
    for (const dataset of [undefined, "", "a", "payments; drop", "../x", 5]) expect(parseExportRequest({ dataset }).ok, String(dataset)).toBe(false);
    for (const from of ["2026-02-30", "2026-13-01", "23/10/2026", "yesterday", "1999-01-01"]) expect(parseExportRequest({ dataset: "payments", from }).ok, from).toBe(false);
    expect(parseExportRequest({ dataset: "payments", from: "2026-10-23", to: "2026-10-01" })).toEqual({ ok: false, error: "The end date must not be before the start date." });
    expect(parseExportRequest({ dataset: "payments", from: "2026-10-23", to: "2026-10-23" }).ok).toBe(true);
    expect(parseExportRequest(null).ok).toBe(false);
  });
  it("includes the whole end day: the database range ends at the start of the next day", () => {
    expect(nextDayStart("2026-10-23")).toBe("2026-10-24T00:00:00Z"); expect(nextDayStart("2026-12-31")).toBe("2027-01-01T00:00:00Z"); expect(nextDayStart("2028-02-28")).toBe("2028-02-29T00:00:00Z");
    expect(isRealDay("2028-02-29")).toBe(true); expect(isRealDay("2027-02-29")).toBe(false);
  });
});
