import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { csvCell, excelSerial, exportFileName, toCsv, toXlsx, type ExportData } from "./file";

const DATA: ExportData = { dataset: "payments", label: "Payments", total: 3, truncated: false, columns: ["Reference", "Created (UTC)", "Amount", "Paid", "Note", "Empty"],
  rows: [["QB-1", "2026-10-23 17:09:48", 40, true, 'He said "hi", twice', null], ["QB-2", "2026-01-01 00:00:00", -2.5, false, "=HYPERLINK(\"http://evil\")", ""], ["QB-3", "2026-06-15 12:30:00", 0, true, "line1\nline2", null]] };

describe("CSV", () => {
  it("starts with a byte-order mark, uses CRLF, quotes commas, quotes and newlines", () => {
    const csv = toCsv(DATA);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split("\r\n")).toHaveLength(5);                                                 // header + 3 rows + the final line end
    expect(csv).toContain('"He said ""hi"", twice"');
    expect(csv).toContain('"line1\nline2"');
    expect(csv).toContain("QB-1,2026-10-23 17:09:48,40,TRUE,");
  });
  it("never lets a text cell run as a spreadsheet formula, but leaves real numbers alone", () => {
    for (const evil of ["=1+1", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\tTAB", "\rCR"]) expect(csvCell(evil), evil).toMatch(/^"?'/);
    expect(csvCell(-2.5)).toBe("-2.5");
    expect(csvCell("-12")).toBe("-12");                                                        // a number held as text is still a number
    expect(csvCell("Ama Mensah")).toBe("Ama Mensah");
    expect(csvCell(null)).toBe(""); expect(csvCell(undefined)).toBe(""); expect(csvCell(false)).toBe("FALSE");
  });
});

describe("Excel", () => {
  const read = (buf: Buffer) => XLSX.read(buf, { type: "buffer" });
  it("has a Data sheet and an About sheet that records the filters", () => {
    const wb = read(toXlsx(DATA, { from: "2026-10-01", to: "2026-10-23", category: "successful", generatedAt: new Date("2026-10-24T08:00:00Z") }));
    expect(wb.SheetNames).toEqual(["Data", "About"]);
    const about = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.About, { header: 1 });
    expect(about).toContainEqual(["Dataset", "Payments"]); expect(about).toContainEqual(["From (UTC, included)", "2026-10-01"]); expect(about).toContainEqual(["Category", "successful"]);
    expect(about).toContainEqual(["Generated (UTC)", "2026-10-24 08:00:00"]); expect(about).toContainEqual(["Rows in this file", 3]);
  });
  it("keeps numbers as numbers and times as real dates (no time-zone shift), so filters and pivots work", () => {
    const ws = read(toXlsx(DATA)).Sheets.Data;
    expect(ws.C2.v).toBe(40); expect(ws.C2.t).toBe("n"); expect(ws.C3.v).toBe(-2.5);
    expect(ws.B2.t).toBe("n"); expect(ws.B2.v).toBeCloseTo(excelSerial("2026-10-23 17:09:48")!, 6);
    expect(XLSX.SSF.format("yyyy-mm-dd hh:mm:ss", ws.B2.v)).toBe("2026-10-23 17:09:48");
    expect(ws.D2.t).toBe("b"); expect(ws.E3.v).toBe('=HYPERLINK("http://evil")'); expect(ws.E3.t).toBe("s");   // stored as text, never as a formula
    expect(ws.F2).toBeUndefined();
    expect(ws["!autofilter"]?.ref).toBe("A1:F4");
  });
  it("warns when the file holds fewer rows than matched", () => {
    const wb = read(toXlsx({ ...DATA, total: 90000, truncated: true }));
    const about = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.About, { header: 1 });
    expect(about.some((r) => r[0] === "Warning")).toBe(true);
  });
  it("handles an empty result", () => {
    const wb = read(toXlsx({ ...DATA, rows: [], total: 0 }));
    expect(XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Data, { header: 1 })).toEqual([DATA.columns]);
  });
});

describe("helpers", () => {
  it("converts a UTC time to an Excel serial exactly", () => { expect(excelSerial("1970-01-01 00:00:00")).toBe(25569); expect(excelSerial("2026-10-23 12:00:00")! % 1).toBeCloseTo(0.5, 9); expect(excelSerial("not a date")).toBeNull(); });
  it("names files by dataset and range, and strips anything odd", () => {
    expect(exportFileName("payments", "2026-10-01", "2026-10-23", "csv")).toBe("quizbox-payments-2026-10-01_to_2026-10-23.csv");
    expect(exportFileName("mk_sales", null, null, "xlsx", new Date("2026-10-24T01:00:00Z"))).toBe("quizbox-mk_sales-start_to_2026-10-24.xlsx");
    expect(exportFileName("../etc/passwd", null, null, "csv", new Date("2026-10-24T00:00:00Z"))).toBe("quizbox-etcpasswd-start_to_2026-10-24.csv");
  });
});
