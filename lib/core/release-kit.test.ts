import { PGlite } from "@electric-sql/pglite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The release kit (scripts/release/make_release_kit.py) must be in step with the migrations, and its read-only database check must actually run.
const MIG = "supabase/migrations", PARTS = "docs/release/sql-parts";
const versions = readdirSync(MIG).filter((f) => f >= "20261020" && f.endsWith(".sql")).sort();
const cut = (sql: string) => sql.split("\n").filter((l) => !["begin;", "commit;"].includes(l.trim().toLowerCase())).join("\n").replace(/\s+/g, " ").trim();

describe("release kit: paste-ready parts", () => {
  it("has parts for every migration from 20261020 onward, each small enough to paste", () => {
    for (const f of versions) {
      const dir = `${PARTS}/${f.slice(0, 14)}`;
      expect(existsSync(`${dir}/p1.sql`), `${f} has no parts: run python scripts/release/make_release_kit.py`).toBe(true);
      const parts = readdirSync(dir).filter((x) => /^p\d+\.sql$/.test(x)).sort((a, b) => Number(a.slice(1, -4)) - Number(b.slice(1, -4)));
      for (const p of parts) expect(readFileSync(`${dir}/${p}`, "utf8").length, `${dir}/${p}`).toBeLessThanOrEqual(9000);
    }
  });
  it("the parts, put back together in order, are the migration (apart from begin and commit)", () => {
    for (const f of versions) {
      const dir = `${PARTS}/${f.slice(0, 14)}`;
      const parts = readdirSync(dir).filter((x) => /^p\d+\.sql$/.test(x)).sort((a, b) => Number(a.slice(1, -4)) - Number(b.slice(1, -4)));
      const joined = parts.map((p) => readFileSync(`${dir}/${p}`, "utf8")).join("\n");
      expect(cut(joined), `${f}: parts are stale, run python scripts/release/make_release_kit.py`).toBe(cut(readFileSync(`${MIG}/${f}`, "utf8")));
    }
  });
  it("every part is complete SQL: it ends with a semicolon and leaves no quote, dollar-quote or comment open", () => {
    // The policy seed once had its insert cut away from its select, so the parts failed when pasted. This reads each part the way the database does.
    const complete = (sql: string) => {
      let i = 0, lastCode = "";
      while (i < sql.length) {
        const c = sql[i];
        if (sql.startsWith("--", i)) { const j = sql.indexOf("\n", i); i = j < 0 ? sql.length : j; continue; }
        if (sql.startsWith("/*", i)) { const j = sql.indexOf("*/", i + 2); if (j < 0) return "open comment"; i = j + 2; continue; }
        if (c === "'") { i++; while (i < sql.length && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1; if (i >= sql.length) return "open quote"; i++; lastCode = "'"; continue; }
        if (c === "$") { const m = /^\$([A-Za-z_][A-Za-z_0-9]*)?\$/.exec(sql.slice(i, i + 80)); if (m) { const j = sql.indexOf(m[0], i + m[0].length); if (j < 0) return `open ${m[0]}`; i = j + m[0].length; lastCode = "$"; continue; } }
        if (!/\s/.test(c)) lastCode = c;
        i++;
      }
      return lastCode === ";" ? "" : `ends with "${lastCode}" instead of a semicolon`;
    };
    for (const f of versions) {
      const dir = `${PARTS}/${f.slice(0, 14)}`;
      for (const p of readdirSync(dir).filter((x) => /^p\d+\.sql$/.test(x))) expect(complete(readFileSync(`${dir}/${p}`, "utf8")), `${dir}/${p}`).toBe("");
    }
  });
  it("lists every migration in index.json", () => {
    const index = JSON.parse(readFileSync(`${PARTS}/index.json`, "utf8")) as { version: string }[];
    expect(index.map((i) => i.version)).toEqual(versions.map((f) => f.slice(0, 14)));
  });
});

describe("release kit: the database fingerprint", () => {
  const run = async (sql: string, setup = "") => { const db = new PGlite(); await db.exec(setup); const r = await db.query<{ version: string; status: string; missing: string }>(sql); await db.close(); return r.rows; };
  for (const part of ["A", "B"]) {
    it(`part ${part} is read-only, runs on an empty database and reports every migration`, async () => {
      const sql = readFileSync(`docs/release/db_fingerprint_${part}.sql`, "utf8");
      expect(/^\s*(insert|update|delete|drop|alter|create|truncate)\b/im.test(sql)).toBe(false);
      const rows = await run(sql);
      expect(rows.length).toBeGreaterThan(8);
      for (const r of rows) expect(["ok", "PARTIAL", "MISSING"]).toContain(r.status);
    });
  }
  it("the 37 and 45 diagnosis runs, is read-only and names the part to re-run", async () => {
    const sql = readFileSync("docs/release/DIAGNOSE_PREVIEW_37_45.sql", "utf8");
    expect(/^\s*(insert|update|delete|drop|alter|create|truncate)\b/im.test(sql)).toBe(false);
    const db = new PGlite();
    await db.exec("create table public.policy_documents(id int, slug text); create table public.policy_versions(document_id int); insert into public.policy_documents values (1,'terms'),(2,'privacy'),(3,'cookies'),(4,'refunds'); insert into public.policy_versions values (1);");
    const rows = (await db.query<{ item: string; status: string }>(sql)).rows; await db.close();
    expect(rows.find((r) => r.item === "37 policy drafts: terms")?.status).toBe("present");
    expect(rows.find((r) => r.item === "37 policy drafts: privacy")?.status).toMatch(/^MISSING \(run 20261037 parts 1 to 3\)$/);
    expect(rows.find((r) => r.item === "45 export functions, part 1: qb_export_ts")?.status).toBe("MISSING (run 20261045 part 1)");
    expect(rows.filter((r) => r.item.startsWith("45 ")).length).toBe(12);
  });
  it("reports PARTIAL when only some objects exist, ok when all do, and counts seeded rows", async () => {
    const b = readFileSync("docs/release/db_fingerprint_B.sql", "utf8");
    const rows = await run(b, "create table public.refund_cases(id int); create table public.company_details(id int); create table public.help_articles(slug text); insert into public.help_articles values ('add-more-players'), ('sell-question-sets');");
    const v = Object.fromEntries(rows.map((r) => [r.version, r.status]));
    expect(v["20261035100000"]).toBe("PARTIAL");        // the table is there, its functions are not
    expect(v["20261042100000"]).toBe("ok");             // the seats guide row exists
    expect(v["20261044100000"]).toBe("MISSING");        // only one of its two guides exists, so the row check fails
    const a = Object.fromEntries((await run(readFileSync("docs/release/db_fingerprint_A.sql", "utf8"))).map((r) => [r.version, r.status]));
    expect(a["20261033100000"]).toBe("ok");             // the stale overloads are absent on an empty database
  });
});
