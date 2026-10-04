import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INTENTIONAL_ANON_RPCS, isIntentionalAnonRpc, unexpectedAnonFunctions } from "./public-rpc-allowlist";

describe("anon RPC allowlist", () => {
  it("is exactly the two reviewed public contracts", () => {
    expect(Object.keys(INTENTIONAL_ANON_RPCS).sort()).toEqual(["qb_marketplace_catalog", "qb_signup_markets"]);
  });

  it("matches names exactly, without prefixes, patterns or prototype keys", () => {
    for (const name of ["qb_signup_markets_v2", "qb_signup", "qb_", "*", "qb_.*", "constructor", "__proto__", "toString", "QB_SIGNUP_MARKETS", "", null, undefined, 1]) {
      expect(isIntentionalAnonRpc(name)).toBe(false);
    }
    expect(isIntentionalAnonRpc("qb_signup_markets")).toBe(true);
  });

  it("flags every other anon-executable function", () => {
    const functions = [
      { name: "qb_marketplace_catalog", anon: true },
      { name: "qb_signup_markets", anon: true },
      { name: "qb_auth_failure", anon: true },
      { name: "qb_complete_onboarding", anon: false },
      { name: "qb_admin_ops", anon: true },
    ];
    expect(unexpectedAnonFunctions(functions).map((f) => f.name)).toEqual(["qb_auth_failure", "qb_admin_ops"]);
  });

  it("matches the migration grant that makes qb_signup_markets public", () => {
    const sql = readFileSync("supabase/migrations/20261003100000_multi_market_platform.sql", "utf8");
    expect(sql).toMatch(/revoke all on function public\.qb_signup_markets\(\)[^;]*from public,anon;/);
    expect(sql).toContain("grant execute on function public.qb_signup_markets() to anon,authenticated;");
  });
});
