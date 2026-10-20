import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The price list (isolated PostgreSQL; the migration is applied unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261030100000_price_list.sql");
const ROLLBACK = read("../../supabase/rollback/price_list.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, FINANCE, TEACHER] = [1, 2, 3].map(id);
let db: PGlite;
const as = async (user: string | null | "service") => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user && user !== "service" ? user : ""]);
  await db.exec(user === "service" ? "set role service_role" : user ? "set role authenticated" : "set role anon");
};
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(sql, params)).rows[0] ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
const save = (code: string, row: object) => rpc("select public.qb_price_save($1,$2)", [code, JSON.stringify(row)]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, full_name text, email text);
    create table public.user_capabilities(user_id uuid not null, capability text not null, active boolean not null default true);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb);
    insert into public.profiles values ('${OWNER}','OWNER','active','Owner','o@example.com'),('${FINANCE}','STUDENT','active','Finance','f@example.com'),('${TEACHER}','TEACHER','active','Teacher','t@example.com');
    insert into public.user_capabilities values ('${FINANCE}','finance_admin',true);
  `);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("price list", () => {
  it("re-applies cleanly without overwriting what the admin changed", async () => {
    await as(OWNER); await save("learner_monthly", { price_minor: 2500, name: "Learner Monthly Plus" });
    await db.exec("reset role"); await db.exec(MIGRATION);
    await as(OWNER); const row = (await rpc("select public.qb_price_list_admin()")).find((r: any) => r.code === "learner_monthly");
    expect(row).toMatchObject({ price_minor: 2500, name: "Learner Monthly Plus" });
  });

  it("starts with unpriced rows: free tiers show as free, paid ones as 'to be announced' (no price, no link)", async () => {
    await as("service"); const list = await rpc("select public.qb_price_list()");
    expect(list.map((r: any) => r.code).sort()).toEqual(["learner_free", "learner_monthly", "learner_term", "school_year", "sponsor_premium", "sponsor_standard", "sponsor_starter", "teacher_free"]);
    const by = Object.fromEntries(list.map((r: any) => [r.code, r]));
    expect(by.learner_free.price_minor).toBe(0); expect(by.teacher_free.price_minor).toBe(0); expect(by.learner_term.price_minor).toBeNull(); expect(by.school_year.price_minor).toBeNull();
    expect(by.sponsor_standard.checkout_url).toBeNull(); expect(by.sponsor_standard.highlight).toBe(true);
    expect(list.every((r: any) => Array.isArray(r.includes) && r.includes.length > 0)).toBe(true);
  });

  it("only owners, admins and finance admins can read the full list or change it; everyone can read the active list", async () => {
    await as(TEACHER); await fails("select public.qb_price_list_admin()", [], /NOT_AUTHORIZED/); await fails("select public.qb_price_save('x_plan', '{\"name\":\"X\",\"audience\":\"other\"}')", [], /NOT_AUTHORIZED/);
    await as(null); await fails("select public.qb_price_list()", [], /permission denied/);
    await as(TEACHER); expect((await rpc("select public.qb_price_list()")).length).toBeGreaterThan(0);
    await as(FINANCE); expect((await rpc("select public.qb_price_list_admin()")).length).toBeGreaterThan(5);
    await fails("select * from public.price_list", [], /permission denied/);
  });

  it("sets a price and a gateway link, shows the link only when a price is set, and rejects unsafe links and bad fields", async () => {
    await as(OWNER);
    await save("school_year", { price_minor: 120000, checkout_url: "https://paystack.com/pay/quizbox-school" });
    await save("sponsor_starter", { checkout_url: "https://pay.example.com/checkout/starter" });                                       // a link but no price yet
    await as("service"); const by = Object.fromEntries((await rpc("select public.qb_price_list()")).map((r: any) => [r.code, r]));
    expect(by.school_year).toMatchObject({ price_minor: 120000, checkout_url: "https://paystack.com/pay/quizbox-school", currency: "GHS" });
    expect(by.sponsor_starter.checkout_url).toBeNull();
    await as(OWNER);
    for (const bad of ["http://insecure.example.com/pay", "javascript:alert(1)", "https://", "https://exa mple.com/x", "//evil.example/x", `https://example.com/${"a".repeat(500)}`]) await fails("select public.qb_price_save('school_year', $1)", [JSON.stringify({ checkout_url: bad })], /check|violates/);
    await fails("select public.qb_price_save('school_year', $1)", [JSON.stringify({ price_minor: -1 })], /check|violates/);
    await fails("select public.qb_price_save('school_year', $1)", [JSON.stringify({ audience: "everyone" })], /check|violates/);
    await fails("select public.qb_price_save('school_year', $1)", [JSON.stringify({ secret_field: 1 })], /INVALID_PRICE/);
    await fails("select public.qb_price_save('school_year', $1)", [JSON.stringify({ includes: [1, 2] })], /INVALID_PRICE/);
    await fails("select public.qb_price_save('brand_new', $1)", [JSON.stringify({ price_minor: 5 })], /INVALID_PRICE/);                    // a new row needs a name and an audience
    await db.exec("reset role"); expect(await rpc("select count(*)::int from public.audit_logs where action = 'price_saved'")).toBeGreaterThan(2);
  });

  it("new rows start inactive; retiring or a sale window hides a row from visitors without deleting it", async () => {
    await as(OWNER);
    const row = await save("campaign_vip", { name: "VIP Campaign", audience: "company", kind: "campaign", period: "campaign", price_minor: 500000, includes: ["Everything"] });
    expect(row.active).toBe(false);
    await as("service"); expect((await rpc("select public.qb_price_list()")).some((r: any) => r.code === "campaign_vip")).toBe(false);
    await as(OWNER); await save("campaign_vip", { active: true }); await as("service"); expect((await rpc("select public.qb_price_list()")).some((r: any) => r.code === "campaign_vip")).toBe(true);
    await as(OWNER); await save("campaign_vip", { ends_at: new Date(Date.now() - 60_000).toISOString(), starts_at: new Date(Date.now() - 3_600_000).toISOString() });
    await as("service"); expect((await rpc("select public.qb_price_list()")).some((r: any) => r.code === "campaign_vip")).toBe(false);
    await as(OWNER); expect((await rpc("select public.qb_price_list_admin()")).some((r: any) => r.code === "campaign_vip")).toBe(true);        // still there for the admin
    await save("learner_monthly", { active: false }); await as("service"); expect((await rpc("select public.qb_price_list()")).some((r: any) => r.code === "learner_monthly")).toBe(false);
  });

  it("the rollback removes the price list", async () => {
    await db.exec("reset role"); await db.exec(ROLLBACK);
    expect(await rpc("select to_regclass('public.price_list') is null")).toBe(true);
  });
});
