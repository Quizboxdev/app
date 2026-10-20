import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The Coin ladder (isolated PostgreSQL; the price list migrations applied in order).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const PRICE = read("../../supabase/migrations/20261030100000_price_list.sql");
const MIGRATION = read("../../supabase/migrations/20261031100000_coin_products.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OWNER = id(1);
let db: PGlite;
const as = async (user: string | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
};
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(sql, params)).rows[0] ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, full_name text, email text);
    create table public.user_capabilities(user_id uuid not null, capability text not null, active boolean not null default true);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb);
    insert into public.profiles values ('${OWNER}','OWNER','active','Owner','o@example.com');
  `);
  await db.exec(PRICE);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("coin products", () => {
  it("re-applies cleanly", async () => { await db.exec(MIGRATION); });

  it("the ladder: one price per Coin, the same across levels, longer plans cost less per day", async () => {
    await as("service" as any);
    const list = await rpc("select public.qb_price_list()");
    const by = Object.fromEntries(list.map((r: any) => [r.code, r]));
    for (const c of ["plan_weekly", "plan_monthly", "plan_term", "plan_yearly"]) expect(by[c].levels).toEqual(["PRIMARY", "JHS", "SHS"]);
    expect(by.plan_monthly).toMatchObject({ coins: 10, days: 30, price_minor: 1000 });
    expect(by.plan_term).toMatchObject({ coins: 25, days: 90, price_minor: 2500 });
    const perDay = ["plan_weekly", "plan_monthly", "plan_term", "plan_yearly"].map((c) => by[c].price_minor / by[c].days);
    expect(perDay).toEqual([...perDay].sort((a, b) => b - a));                       // strictly cheaper per day the longer the plan
  });

  it("seat bundles are exactly 1 Coin per participant", async () => {
    await as("service" as any);
    const by = Object.fromEntries((await rpc("select public.qb_price_list()")).map((r: any) => [r.code, r]));
    for (const n of [10, 20, 50, 100, 200, 500, 1000]) expect(by[`seats_${n}`]).toMatchObject({ coins: n, price_minor: n * 100 });
  });

  it("a row's price cannot disagree with its Coins", async () => {
    await as(OWNER);
    await fails("select public.qb_price_save('plan_monthly', $1)", [JSON.stringify({ price_minor: 999 })], /violates|check/);
    await rpc("select public.qb_price_save('plan_monthly', $1)", [JSON.stringify({ coins: 12 })]);
    const row = await rpc("select public.qb_price_save('plan_monthly', $1)", [JSON.stringify({ coins: 12 })]);
    expect(row).toMatchObject({ coins: 12, price_minor: 1200 });
    await rpc("select public.qb_price_save('plan_monthly', $1)", [JSON.stringify({ coins: 10 })]);
  });

  it("the old learner plans are switched off, not deleted", async () => {
    await db.exec("reset role");
    const rows = (await db.query<any>("select code, active from public.price_list where code in ('learner_monthly','learner_term')")).rows;
    expect(rows.every((r) => r.active === false)).toBe(true); expect(rows).toHaveLength(2);
  });
});
