import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Migration 20261121110000: the parent's waiting list is the same whether or not the email has an account, shows only a masked address, and drops answered requests.
const SQL = readFileSync("supabase/migrations/20261121110000_family_link_privacy.sql", "utf8");
const ROLLBACK = readFileSync("supabase/rollback/family_link_privacy.sql", "utf8");
const P = "00000000-0000-0000-0000-0000000000a1", Q = "00000000-0000-0000-0000-0000000000a2", S = "00000000-0000-0000-0000-0000000000c1", KID = "00000000-0000-0000-0000-0000000000c2";
const W = "00000000-0000-0000-0000-0000000000f1";

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, role text);
    create table public.account_relationships (id uuid primary key default gen_random_uuid(), source_user_id uuid, target_user_id uuid, status text default 'requested', family_workspace_id uuid, label text, created_at timestamptz default now());
    insert into public.profiles values ('${P}', 'sponsor'), ('${Q}', 'teacher'), ('${S}', 'student'), ('${KID}', 'student');
  `);
  await db.exec(SQL);
  return db;
}
const as = (db: PGlite, uid: string) => db.exec(`select set_config('test.uid', '${uid}', false)`);
const pending = async (db: PGlite) => (await db.query<{ r: Array<{ label: string }> }>("select public.qb_family_pending_requests() as r")).rows[0].r;

describe("family link privacy", () => {
  it("lists a request for an email with no account exactly like one that has an account, masked", async () => {
    const db = await setup(); await as(db, P);
    await db.exec(`insert into public.account_relationships(source_user_id, target_user_id, family_workspace_id, label) values ('${P}', '${KID}', '${W}', 'esi@x.test')`);
    await db.exec("select public.qb_family_note_link_request('esi@x.test'); select public.qb_family_note_link_request('nobody@x.test')");
    const labels = (await pending(db)).map((r) => r.label).sort();
    expect(labels).toEqual(["e***@x.test", "n***@x.test"]);
    expect(JSON.stringify(await pending(db))).not.toContain("esi@");
  });
  it("shows a request once, not once per attempt, and ignores a malformed address", async () => {
    const db = await setup(); await as(db, P);
    await db.exec("select public.qb_family_note_link_request('Esi@x.test'); select public.qb_family_note_link_request('esi@x.test'); select public.qb_family_note_link_request('not an email')");
    expect(await pending(db)).toHaveLength(1);
  });
  it("hides a request once it is answered, but shows a new request for the same email after an old one was declined", async () => {
    const db = await setup(); await as(db, P);
    await db.exec(`insert into public.account_relationships(source_user_id, target_user_id, family_workspace_id, label, created_at) values ('${P}', '${KID}', '${W}', 'esi@x.test', now() - interval '3 days')`);
    await db.exec("update public.account_relationships set status = 'revoked'");
    expect(await pending(db)).toEqual([]);
    await db.exec("select public.qb_family_note_link_request('esi@x.test')");
    expect(await pending(db)).toHaveLength(1);
    await db.exec(`insert into public.account_relationships(source_user_id, target_user_id, family_workspace_id, label) values ('${P}', '${S}', '${W}', 'esi@x.test')`);
    await db.exec("update public.account_relationships set status = 'active' where status = 'requested'");
    expect(await pending(db)).toEqual([]);
  });
  it("only ever shows the caller's own requests, and refuses a student", async () => {
    const db = await setup(); await as(db, P);
    await db.exec("select public.qb_family_note_link_request('esi@x.test')");
    await as(db, Q);
    expect(await pending(db)).toEqual([]);
    await as(db, S);
    await expect(db.exec("select public.qb_family_note_link_request('a@b.test')")).rejects.toThrow(/QB_FAMILY_NOT_ADULT/);
  });
  it("is safe to run twice and rolls back cleanly", async () => {
    const db = await setup(); await db.exec(SQL); await db.exec(ROLLBACK);
    expect((await db.query("select to_regclass('public.family_link_notes') as t")).rows[0]).toEqual({ t: null });
  });
});
