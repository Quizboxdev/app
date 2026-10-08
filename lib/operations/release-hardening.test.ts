import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static regression coverage for migrations 20261010100000 (admin RPC budget order) and 20261010110000 (auth-failure hardening).
// Live behaviour is covered by auth-failure.live.test.ts and factory.live.test.ts.
const order = readFileSync("supabase/migrations/20261010100000_admin_rpc_budget_order.sql", "utf8");
const hardening = readFileSync("supabase/migrations/20261010110000_auth_failure_hardening.sql", "utf8");
const fn = (name: string) => { const start = order.indexOf(`create or replace function public.${name}(`); const end = order.indexOf("end $$;", start); return order.slice(start, end); };

describe.each([
  ["qb_content_ingest", "generation_context"],
  ["qb_content_request_generation", "generation_context"],
  ["qb_content_review", "assert_question"],
])("%s throttle order", (name, gate) => {
  const body = fn(name);
  it("charges the budget before the market/content gate", () => {
    expect(body.indexOf("consume_budget")).toBeGreaterThan(-1);
    expect(body.indexOf("consume_budget")).toBeLessThan(body.indexOf(gate));
  });
  it("runs the gate inside the protected block so the budget row commits", () => {
    const innerBegin = body.indexOf("begin", body.indexOf("end if;", body.indexOf("consume_budget")));
    expect(body.indexOf(gate)).toBeGreaterThan(innerBegin);
    expect(body.indexOf(gate)).toBeLessThan(body.indexOf("exception when others"));
  });
  it("keeps the error contract and the core call", () => {
    expect(body).toContain("'QB_RATE_LIMITED'");
    expect(body).toContain("case when SQLSTATE='42501' then '403' else '400' end");
    expect(body).toContain(`core_qb_${name.replace("qb_", "")}`);
  });
  it("has no gate ahead of the budget", () => {
    expect(body.slice(0, body.indexOf("consume_budget"))).not.toContain(gate);
  });
});

describe("qb_auth_failure hardening migration", () => {
  it("revokes direct table privileges from anon and authenticated, and never regrants them", () => {
    expect(hardening).toMatch(/revoke all on table public\.system_events from anon, authenticated/);
    expect(hardening).not.toMatch(/grant\s+[^;]*on\s+(table\s+)?public\.system_events\s+to\s+[^;]*(anon|authenticated|public)/i);
  });
  it("keeps the RPC path: unchanged signature and grants", () => {
    expect(hardening).toContain("create or replace function public.qb_auth_failure(p_code text)");
    expect(hardening).toMatch(/grant execute on function public\.qb_auth_failure\(text\) to anon, authenticated/);
    expect(hardening).toMatch(/revoke all on function public\.qb_auth_failure\(text\) from public/);
  });
  it("constrains p_code to a known list with a fixed fallback", () => {
    expect(hardening).toContain("'invalid_credentials'");
    expect(hardening).toContain("'AUTH_FAILED'");
    expect(hardening).not.toContain("[A-Za-z_ ]");
  });
  it("enforces a per-source cap before the global backstop, keyed on the non-spoofable Cloudflare address", () => {
    expect(hardening.indexOf("auth_failure_budget(source")).toBeLessThan(hardening.indexOf(">=120"));
    expect(hardening).toContain("if n>10 then return; end if;");
    expect(hardening.indexOf("cf-connecting-ip")).toBeGreaterThan(-1);
    expect(hardening.indexOf("cf-connecting-ip")).toBeLessThan(hardening.indexOf("x-forwarded-for"));
  });
  it("stores only a digest of the source, never the address", () => {
    expect(hardening).toContain("extensions.digest(");
    expect(hardening).toContain("'source',src");
    expect(hardening).not.toContain("'source',ip");
  });
  it("bounds retention and tracks the supporting index", () => {
    expect(hardening).toContain("purge_auth_failures");
    expect(hardening).toContain("interval '30 days'");
    expect(hardening).toContain("limit p_batch");
    expect(hardening).toContain("create index if not exists system_events_type_idx on public.system_events(event_type, created_at desc)");
    expect(hardening.indexOf("random()<0.02")).toBeLessThan(hardening.indexOf("if n>10 then return"));
  });
  it("keeps the budget table and purge function private", () => {
    expect(hardening).toContain("revoke all on table quizbox_private.auth_failure_budget from public, anon, authenticated");
    expect(hardening).toContain("revoke all on function quizbox_private.purge_auth_failures(interval,integer) from public, anon, authenticated");
  });
});

describe("public function contracts that must not change in this release", () => {
  it("does not touch qb_signup_markets or qb_marketplace_catalog", () => {
    for (const sql of [order, hardening]) {
      expect(sql).not.toContain("qb_signup_markets");
      expect(sql).not.toContain("qb_marketplace_catalog");
    }
  });
});
