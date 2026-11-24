import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The browser wrapper and the database must agree: every function the wrapper calls exists in a mock-exam migration, every argument it sends is a real parameter, and every parameter without a default is sent.
const ts = readFileSync(new URL("./mock-exams.ts", import.meta.url), "utf8");
const dir = new URL("../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir).filter((f) => /^2026112[0-9]+_mock_exams/.test(f)).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");

function sqlParams(name: string): Array<{ name: string; hasDefault: boolean }> | null {
  // The parameter list ends at the first ") returns"; defaults such as now() contain brackets, so a plain "up to the first )" would cut it short.
  const start = sql.search(new RegExp(`create or replace function public\\.${name}\\(`, "i"));
  if (start < 0) return null;
  const open = sql.indexOf("(", start), close = sql.slice(open).search(/\)\s*returns/i);
  return sql.slice(open + 1, open + close).split(/,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean).map((x) => ({ name: x.split(/\s+/)[0], hasDefault: /\bdefault\b/i.test(x) }));
}
const calls = [...ts.matchAll(/rpc<[^(]*>\("(qb_mock_[a-z_]+)"(?:,\s*\{([^}]*)\})?/g)].map((m) => ({ fn: m[1], args: m[2] ? [...m[2].matchAll(/\b(p_[a-z_]+|p)\b(?=\s*[:,}]|\s*$)/g)].map((a) => a[1]) : [] }));

describe("mock exams: the wrapper matches the database", () => {
  it("finds the calls", () => { expect(calls.length).toBeGreaterThan(30); });
  for (const c of calls) {
    it(`${c.fn} exists and is called with its own parameters`, () => {
      const params = sqlParams(c.fn);
      expect(params, `${c.fn} is not defined in a mock-exam migration`).not.toBeNull();
      const names = params!.map((p) => p.name);
      for (const a of c.args) expect(names, `${c.fn} has no parameter ${a}`).toContain(a);
      for (const p of params!.filter((x) => !x.hasDefault)) expect(c.args, `${c.fn} requires ${p.name}`).toContain(p.name);
    });
  }
  it("every function a browser may call is granted to signed-in users only (except the two public listing functions)", () => {
    const granted = [...sql.matchAll(/grant execute on function ([^;]*?) to ([^;]*);/gis)];
    const toAnon = granted.filter((g) => /\banon\b/i.test(g[2])).flatMap((g) => [...g[1].matchAll(/public\.([a-z_0-9]+)\(/g)].map((m) => m[1])).sort();
    expect(toAnon).toEqual(["qb_mock_listing_info", "qb_mock_listing_kinds"]);
  });
});
