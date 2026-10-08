import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Regression coverage for migration 20261009100000 (statically verified here; the live behavior is covered by
// closure.live.test.ts "denied attempt starts are throttled…" and factory.live.test.ts "does not group or mutate duplicates across markets").
const sql = readFileSync("supabase/migrations/20261009100000_throttle_and_scoped_duplicates.sql", "utf8");
const startAttempt = sql.slice(sql.indexOf("create or replace function public.qb_start_attempt"), sql.indexOf("-- B."));
const ingestBlock = sql.slice(sql.indexOf("do $migration$"));

describe("qb_start_attempt throttle ordering", () => {
  it("charges the rate budget before the market/content gate", () => {
    expect(startAttempt.indexOf("consume_budget")).toBeGreaterThan(-1);
    expect(startAttempt.indexOf("consume_budget")).toBeLessThan(startAttempt.indexOf("assessment_allowed"));
  });
  it("raises the gate inside the protected block so the budget row is committed, not rolled back", () => {
    const gate = startAttempt.indexOf("assessment_allowed");
    const innerBegin = startAttempt.indexOf("begin", startAttempt.indexOf("end if;", startAttempt.indexOf("consume_budget")));
    const handler = startAttempt.indexOf("exception when others");
    expect(innerBegin).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(innerBegin);
    expect(gate).toBeLessThan(handler);
  });
  it("keeps the authorization result and error contract unchanged", () => {
    expect(startAttempt).toContain("raise exception 'QB_CONTENT_SOURCE_DENIED' using errcode='42501'");
    expect(startAttempt).toContain("'QB_RATE_LIMITED'");
    expect(startAttempt).toContain("case when SQLSTATE='42501' then '403' else '400' end");
    expect(startAttempt).toContain("core_qb_start_attempt");
  });
  it("does not leave a pre-budget gate on a separate line before the budget", () => {
    expect(startAttempt.slice(0, startAttempt.indexOf("consume_budget"))).not.toContain("assessment_allowed");
  });
});

describe("ingest duplicate grouping scope", () => {
  const newLookup = ingestBlock.slice(ingestBlock.indexOf("new_lookup constant text"), ingestBlock.indexOf("old_update constant text"));
  const newUpdate = ingestBlock.slice(ingestBlock.indexOf("new_update constant text"), ingestBlock.indexOf("begin\n body"));
  it("limits duplicate lookup to the same market, platform scope and caller-authorized questions", () => {
    expect(newLookup).toContain("qc.market_id=(");
    expect(newLookup).toContain("q.tenant_id is null");
    expect(newLookup).toContain("quizbox_market.question_allowed(q.id)");
  });
  it("limits the grouping UPDATE to the same market and rows the caller may modify", () => {
    expect(newUpdate).toContain("uc.market_id=(select c.market_id");
    expect(newUpdate).toContain("u.tenant_id is null");
    expect(newUpdate).toContain("quizbox_market.question_allowed(u.id)");
    expect(newUpdate).not.toMatch(/where text_hash=inserted\.text_hash;/);
  });
  it("is guarded and idempotent", () => {
    expect(ingestBlock).toContain("INGEST_DUPLICATE_CONTRACT_MISMATCH");
    expect(ingestBlock).toContain("already applied");
  });
  it("ships a rollback", () => {
    expect(readFileSync("supabase/rollback/throttle_and_scoped_duplicates.sql", "utf8")).toContain("qb_start_attempt");
  });
});
