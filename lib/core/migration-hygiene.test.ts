import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A guard for every database change made from the refund tools onward: a function that runs with its owner's rights (security definer) must pin its search path, otherwise a caller could shadow a table or function
// it uses. New functions must also say who may run them, in the same migration (replacing an existing function keeps its permissions, and trigger functions cannot be called directly).
const dir = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
const files = readdirSync(dir).filter((f) => /^2026103[5-9]|^202610[4-9]/.test(f) && f.endsWith(".sql")).sort();
const functions = (sql: string) => [...sql.matchAll(/create (?:or replace )?function ((?:public|quizbox_core)\.[a-z_0-9]+)\(([^$]*?)\$(?:fn|body)?\$/gs)].map((m) => ({ name: m[1], head: m[0] }));

describe("migration hygiene (refund tools onward)", () => {
  it("looks at the recent migrations", () => { expect(files.length).toBeGreaterThanOrEqual(8); });
  it("every security definer function pins its search path", () => {
    const missing: string[] = [];
    for (const f of files) for (const fn of functions(readFileSync(dir + f, "utf8"))) if (/security definer/i.test(fn.head) && !/search_path/i.test(fn.head)) missing.push(`${f}: ${fn.name}`);
    expect(missing).toEqual([]);
  });
  it("every new function is given explicit permissions in its own migration (except trigger functions and replacements of older functions)", () => {
    const replaced = new Set(["public.qb_payment_intent_create", "public.challenge_join", "public.challenge_start", "public.qb_free_sessions_used", "public.qb_has_subscription"]);
    const missing: string[] = [];
    for (const f of files) {
      const sql = readFileSync(dir + f, "utf8");
      for (const fn of functions(sql)) {
        if (/returns trigger/i.test(fn.head) || replaced.has(fn.name)) continue;
        if (!new RegExp(`(?:revoke|grant)[^;]*${fn.name.replace(".", "\\.")}\\(`, "is").test(sql)) missing.push(`${f}: ${fn.name}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it("no function is granted to the anonymous role unless it is meant to be public", () => {
    const publicOk = new Set(["qb_mk_catalog", "qb_mk_item_public", "qb_mk_enabled", "qb_policy_public", "qb_challenge_seat_status", "qb_help_list", "qb_help_get", "qb_help_search", "qb_price_list", "qb_subscription_catalog"]);
    const loose: string[] = [];
    for (const f of files) {
      const sql = readFileSync(dir + f, "utf8");
      for (const g of sql.matchAll(/grant execute on function ([^;]*?) to ([^;]*);/gis)) if (/\banon\b/i.test(g[2])) for (const name of g[1].matchAll(/public\.([a-z_0-9]+)\(/g)) if (!publicOk.has(name[1])) loose.push(`${f}: ${name[1]}`);
    }
    expect(loose).toEqual([]);
  });
});
