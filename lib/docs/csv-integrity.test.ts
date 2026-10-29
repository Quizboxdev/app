import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The audit and beta-testing registers are meant to open cleanly in a spreadsheet: every row must have the same number of columns as the header (a field with a comma must be in quotes).
const FILES = ["../../docs/audit/audit-findings.csv", "../../docs/audit/test-coverage-matrix.csv", "../../docs/beta-testing/test-case-register.csv"];

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c; }
    else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); field = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

describe("registers are well-formed CSV", () => {
  it("parses a quoted comma and an escaped quote", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
  for (const f of FILES) {
    it(`${f.split("/").pop()} has the same number of columns in every row`, () => {
      const rows = parseCsv(readFileSync(new URL(f, import.meta.url), "utf8")), n = rows[0].length;
      expect(n).toBeGreaterThan(5);
      expect(rows.filter((r) => r.length !== n).map((r) => r[0])).toEqual([]);
    });
  }
});
