import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The draft holder (isolated PostgreSQL; the migration is applied unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261028100000_activity_drafts.sql");
const ROLLBACK = read("../../supabase/rollback/activity_drafts.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ANA, BEN, CHILD] = [1, 2, 3].map(id);
let db: PGlite;
const as = async (user: string | null | "service") => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user && user !== "service" ? user : ""]);
  await db.exec(user === "service" ? "set role service_role" : user ? "set role authenticated" : "set role anon");
};
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(sql, params)).rows[0] ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
const save = (kind: string, key: string, title: string, payload: object = { a: 1 }, path: string | null = "/creator?format=competition") => rpc("select public.qb_draft_save($1,$2,$3,$4,$5)", [kind, key, title, JSON.stringify(payload), path]);
const sql = async (text: string, params: unknown[] = []) => { await db.exec("reset role"); return (await db.query<any>(text, params)).rows; };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, full_name text, email text);
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, managed_by uuid);
    create table public.notifications(id uuid primary key default gen_random_uuid(), recipient_user_id uuid, title text, message text, link text, category text);
    create function public.qb_challenge_notify(p_user uuid, p_title text, p_message text, p_link text, p_category text default 'system') returns void language sql as $$ insert into public.notifications(recipient_user_id,title,message,link,category) values (p_user,p_title,p_message,p_link,p_category) $$;
    insert into public.profiles values ('${ANA}','TEACHER','active','Ana','ana@example.com'),('${BEN}','STUDENT','active','Ben','ben@example.com'),('${CHILD}','STUDENT','active','Child',null);
    insert into public.student_profiles(user_id, managed_by) values ('${BEN}',null),('${CHILD}','${ANA}');
  `);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("draft holder", () => {
  it("re-applies cleanly", async () => { await db.exec(MIGRATION); });

  it("saves, reads back, replaces in place, lists and deletes, only for its owner", async () => {
    await as(ANA);
    const first = await save("competition", "new", "Spelling Cup", { title: "Spelling Cup", step: 2 });
    expect(new Date(first.expires_at).getTime() - Date.now()).toBeGreaterThan(23.9 * 3_600_000);
    await save("competition", "new", "Spelling Cup v2", { title: "Spelling Cup", step: 3 });
    const got = await rpc("select public.qb_draft_get('competition','new')");
    expect(got).toMatchObject({ title: "Spelling Cup v2", payload: { step: 3 }, path: "/creator?format=competition" });
    expect(await rpc("select jsonb_array_length(public.qb_draft_list())")).toBe(1);
    await as(BEN); expect(await rpc("select public.qb_draft_get('competition','new')")).toBeNull(); expect(await rpc("select jsonb_array_length(public.qb_draft_list())")).toBe(0);
    await db.query("select public.qb_draft_discard($1)", [first.id]);                                                  // not Ben's: nothing happens
    await as(ANA); expect(await rpc("select jsonb_array_length(public.qb_draft_list())")).toBe(1);
    await db.query("select public.qb_draft_delete('competition','new')"); expect(await rpc("select public.qb_draft_get('competition','new')")).toBeNull();
  });

  it("refuses signed-out callers, young learners, bad kinds, odd keys and oversize drafts; direct table access is closed", async () => {
    await as(null); await fails("select public.qb_draft_save('practice','new','x','{}'::jsonb,null)", [], /permission denied/);
    await as(CHILD); await fails("select public.qb_draft_save('practice','new','x','{}'::jsonb,null)", [], /NOT_AUTHORIZED/);
    await as(ANA);
    await fails("select public.qb_draft_save('hack','new','x','{}'::jsonb,null)", [], /check/);
    await fails("select public.qb_draft_save('practice','a b/c','x','{}'::jsonb,null)", [], /check/);
    await fails("select public.qb_draft_save('practice','new','x',$1::jsonb,null)", [JSON.stringify({ blob: "x".repeat(100_500) })], /check/);
    await fails("select public.qb_draft_save('practice','new','x','{}'::jsonb,'https://evil.example')", [], /check/);
    await fails("select * from public.activity_drafts", [], /permission denied/);
  });

  it("allows at most 20 drafts per person, but always lets an existing one be updated", async () => {
    await as(ANA);
    for (let i = 0; i < 19; i++) await save("assignment", `k${i}`, `Draft ${i}`);              // plus the "practice" fixtures below stay under the cap
    const live = await rpc("select jsonb_array_length(public.qb_draft_list())");
    for (let i = live; i < 20; i++) await save("other", `fill${i}`, "fill");
    await fails("select public.qb_draft_save('other','one-too-many','x','{}'::jsonb,null)", [], /TOO_MANY_DRAFTS/);
    await save("assignment", "k0", "Updated while full");
    await sql("delete from public.activity_drafts where user_id = $1", [ANA]);
  });

  it("each save restarts the 24 hours but never beyond 72 hours from the first save; 'keep' extends the same way", async () => {
    await as(ANA);
    const d = await save("challenge", "new", "Quiz");
    await sql("update public.activity_drafts set created_at = now() - interval '71 hours', expires_at = now() + interval '1 hour' where id = $1", [d.id]);
    await as(ANA); const again = await save("challenge", "new", "Quiz still");
    const left = (new Date(again.expires_at).getTime() - Date.now()) / 3_600_000;
    expect(left).toBeGreaterThan(0.9); expect(left).toBeLessThan(1.1);                                                 // capped at 72 hours from creation
    await sql("update public.activity_drafts set created_at = now() - interval '2 hours', expires_at = now() + interval '30 minutes' where id = $1", [d.id]);
    await as(ANA); const kept = await rpc("select public.qb_draft_keep($1)", [d.id]);
    expect((new Date(kept.expires_at).getTime() - Date.now()) / 3_600_000).toBeGreaterThan(23.9);
    await as(BEN); await fails("select public.qb_draft_keep($1)", [d.id], /NOT_FOUND/);
    await sql("delete from public.activity_drafts");
  });

  it("the sweep warns once when two hours are left, deletes what has expired, and a new save clears the warning", async () => {
    await as(ANA); const soon = await save("sponsor_competition", "new", "Bank Cup", { x: 1 }, "/sponsor/workspace");
    await save("practice", "new", "Old one");
    await save("assignment", "new", "Plenty of time");
    await sql("update public.activity_drafts set expires_at = now() + interval '90 minutes' where id = $1", [soon.id]);
    await sql("update public.activity_drafts set expires_at = now() - interval '1 minute' where kind = 'practice'");
    await as(ANA); await fails("select public.qb_drafts_sweep()", [], /permission denied/);
    await as("service"); const first = await rpc("select public.qb_drafts_sweep()");
    expect(first.purged).toBe(1); expect(first.warned).toHaveLength(1);
    expect(first.warned[0]).toMatchObject({ kind: "sponsor_competition", label: "sponsored competition", title: "Bank Cup", path: "/sponsor/workspace", email: "ana@example.com" });
    const told = await sql("select title, message, link from public.notifications where recipient_user_id = $1", [ANA]);
    expect(told).toHaveLength(1); expect(told[0].title).toMatch(/sponsored competition will be deleted soon/); expect(told[0].message).toMatch(/Bank Cup/); expect(told[0].link).toBe("/sponsor/workspace");
    await as("service"); const second = await rpc("select public.qb_drafts_sweep()");
    expect(second.purged).toBe(0); expect(second.warned).toEqual([]);                                                  // warned only once
    await as(ANA); await save("sponsor_competition", "new", "Bank Cup", { x: 2 }, "/sponsor/workspace");              // edited again: restarted
    expect((await sql("select warned_at from public.activity_drafts where id = $1", [soon.id]))[0].warned_at).toBeNull();
    expect(await rpc("select public.qb_draft_get('practice','new')")).toBeNull();
    await sql("delete from public.activity_drafts");
  });

  it("the rollback removes the holder", async () => {
    await db.exec("reset role"); await db.exec(ROLLBACK);
    expect(await rpc("select to_regclass('public.activity_drafts') is null")).toBe(true);
    expect(await rpc("select count(*)::int from pg_proc where proname like 'qb_draft%'")).toBe(0);
    await db.exec(MIGRATION);
  });
});
