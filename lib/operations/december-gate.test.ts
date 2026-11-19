import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// December 2026 release-readiness gate: safety of the gate itself, plus the mobile-reliability checks that do not need a database.
// The database checks live in supabase/tests/december_readiness_gate.sql (run with scripts/readiness/run-december-gate.ps1).
const root = (p: string) => new URL(`../../${p}`, import.meta.url);
const read = (p: string) => readFileSync(root(p), "utf8");
const GATE = read("supabase/tests/december_readiness_gate.sql");
const RUNNER = read("scripts/readiness/run-december-gate.ps1");

describe("the gate file is safe to run on Preview", () => {
  it("is one transaction that ends in ROLLBACK and never commits", () => {
    expect(GATE).toMatch(/^begin;\s*$/m);
    expect(GATE).not.toMatch(/^\s*commit\s*;/im);
    expect(GATE.trimEnd().split("\n").filter((l) => /^rollback;/i.test(l)).length).toBe(1);
    expect(GATE.indexOf("rollback;")).toBeGreaterThan(GATE.lastIndexOf("pg_temp.rec("));   // the report is printed before the rollback
  });

  it("uses synthetic data only and never destroys real objects", () => {
    expect(GATE).not.toMatch(/^\s*truncate\s|drop\s+table\s+(?!if exists pg_temp\.)|drop\s+schema|alter\s+system|copy\s+.*\s+from\s+program/im);
    const emails = GATE.match(/[\w.-]+@[\w.-]+\.\w+/g) ?? [];
    expect(emails.length).toBeGreaterThan(5);
    for (const e of emails) expect(e).toMatch(/@e2e\.quizbox\.invalid$/);
    expect(GATE).not.toMatch(/\.env\.local|service_role_key|password\s*=/i);
  });

  it("deletes only rows it created itself", () => {
    const deletes = GATE.match(/^\s*delete from [^;]+;/gim) ?? [];
    expect(deletes.length).toBeGreaterThan(0);
    for (const d of deletes) expect(d).toMatch(/pg_temp\.gid\(|DECGATE|decgate|QB07-|operation_budgets|class_memberships where student_user_id|title = 'DECGATE|join_code = |upper\(join_code\)|user_id = pg_temp|actor_id|key = 'free_practice_sessions'|where user_id in \(select id from gate_ids/);
  });

  it("has unique check ids and covers every area in the brief", () => {
    const ids = [...GATE.matchAll(/pg_temp\.rec\('([A-Z]{2})','([A-Z]{2}-\d+b?)'/g)].map((m) => m[2]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(85);
    const areas = new Set([...GATE.matchAll(/pg_temp\.rec\('([A-Z]{2})'/g)].map((m) => m[1]));
    // AU authentication, CL class creation, JN class-code joining, AS approved-content assignment, QZ quiz submission, RP reporting, GD guardian linking,
    // AG age safeguards, EN pilot entitlement, MB mobile reliability, TN cross-tenant security
    for (const a of ["AU", "CL", "JN", "AS", "QZ", "RP", "GD", "AG", "EN", "MB", "TN"]) expect(areas.has(a), `area ${a}`).toBe(true);
  });

  it("the runner refuses Production and refuses a gate file that could commit", () => {
    expect(RUNNER).toMatch(/never touches Production/);
    expect(RUNNER).toMatch(/fmgccmqxfjppqydkhaiu/);
    expect(RUNNER).toMatch(/must end in ROLLBACK/);
    expect(RUNNER).toMatch(/RUN GATE ON PREVIEW/);
    expect(RUNNER).not.toMatch(/PGPASSWORD\s*=\s*["'][^"']+["']/);   // no password written into the script
  });
});

describe("mobile reliability that needs no database", () => {
  const manifest = read("app/manifest.ts");
  const layout = read("app/layout.tsx");
  const worker = read("public/sw.js");
  const attemptPage = read("app/(app)/student/attempt/[id]/page.tsx");

  it("can be installed on a phone: standalone, a start page, a 192 and a 512 icon, one maskable", () => {
    expect(manifest).toMatch(/display:\s*"standalone"/);
    expect(manifest).toMatch(/start_url:\s*"\/student"/);
    expect(manifest).toMatch(/sizes:\s*"192x192"/);
    expect(manifest).toMatch(/sizes:\s*"512x512"/);
    expect(manifest).toMatch(/purpose:\s*"maskable"/);
    for (const m of manifest.matchAll(/src:\s*"(\/[^"]+)"/g)) expect(existsSync(root(`public${m[1]}`)), m[1]).toBe(true);
  });

  it("scales to the phone screen and lets people zoom (no locked scale)", () => {
    expect(layout).toMatch(/width:\s*"device-width"/);
    expect(layout).toMatch(/initialScale:\s*1/);
    expect(layout).not.toMatch(/maximumScale|userScalable|user-scalable/i);
  });

  it("the service worker never stores pages, sign-in data or API calls, and only answers GET from this site", () => {
    expect(worker).toMatch(/request\.method !== "GET"\) return/);
    expect(worker).toMatch(/url\.origin !== self\.location\.origin\) return/);
    expect(worker).toMatch(/CACHEABLE = \/\^\\\/\(_next\\\/static\\\/\|brand\\\/\|fonts\\\/\)\//);
    expect(worker).toMatch(/request\.mode === "navigate"[\s\S]*fetch\(request\)\.catch/);
    expect(existsSync(root("public/offline.html"))).toBe(true);
    for (const m of worker.matchAll(/"(\/(?:brand|offline)[^"]+)"/g)) expect(existsSync(root(`public${m[1]}`)), m[1]).toBe(true);
  });

  it("the answer page retries when the connection returns, warns before leaving with unsaved answers, and re-checks the clock when the phone wakes", () => {
    expect(attemptPage).toMatch(/addEventListener\("online"/);
    expect(attemptPage).toMatch(/addEventListener\("beforeunload"/);
    expect(attemptPage).toMatch(/addEventListener\("visibilitychange"/);
    expect(attemptPage).toMatch(/addEventListener\("pageshow"/);
    expect(attemptPage).toMatch(/submitAttempt\(params\.id, "time_expired"\)/);
  });

  // KNOWN DEFECT MB-D1 (P2). Answers waiting for the network are kept only in the page's memory. If the phone's browser reloads or kills the tab during a
  // lost signal (common on low-memory phones), those answers are gone even though the attempt resumes. This test states the wanted behaviour and is expected
  // to fail today; `it.fails` turns it red the day the defect is fixed, so the marker is removed then. See docs/release-readiness/DEC-2026-GATE.md.
  it.fails("MB-D1: answers not yet saved survive a reload of the answer page (kept in browser storage)", () => {
    expect(attemptPage).toMatch(/sessionStorage|localStorage|indexedDB/);
  });
});
