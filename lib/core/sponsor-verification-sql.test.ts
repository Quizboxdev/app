import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Migration 20261121120000: the sponsor verification queue and decision. Only a super administrator may use either; a decline needs a reason; the sponsor is told.
const SQL = readFileSync("supabase/migrations/20261121120000_sponsor_verification.sql", "utf8");
const ADMIN = "00000000-0000-0000-0000-0000000000a1", SPUSER = "00000000-0000-0000-0000-0000000000b1", SP = "00000000-0000-0000-0000-0000000000c1";

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create schema quizbox_market; create function quizbox_market.is_super() returns boolean language sql stable as $$ select coalesce(nullif(current_setting('test.super', true), ''), 'off') = 'on' $$;
    create schema quizbox_core; create table public.audit_log (action text, entity_id uuid, details jsonb);
    create function quizbox_core.audit(a text, e text, i uuid, d jsonb default '{}') returns void language sql as $$ insert into public.audit_log values (a, i, d) $$;
    create table public.profiles (id uuid primary key, email text);
    create table public.sponsor_profiles (id uuid primary key default gen_random_uuid(), user_id uuid not null, sponsor_type text, organization_name text, contact_name text, website text, country text,
      verification_status text not null default 'PENDING', status text not null default 'ACTIVE', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.notifications (id uuid primary key default gen_random_uuid(), recipient_user_id uuid, recipient_role text, type text, title text, message text, entity_type text, entity_id uuid);
    insert into public.profiles values ('${ADMIN}', 'admin@x.test'), ('${SPUSER}', 'sponsor@x.test');
    insert into public.sponsor_profiles(id, user_id, organization_name, sponsor_type, country) values ('${SP}', '${SPUSER}', 'Akwaaba Foundation', 'ORGANIZATION', 'Ghana'), ('00000000-0000-0000-0000-0000000000c9', '${ADMIN}', 'Ama Mensah', 'INDIVIDUAL', 'Ghana');
  `);
  await db.exec(SQL);
  return db;
}
const as = (db: PGlite, uid: string, sup: boolean) => db.exec(`select set_config('test.uid', '${uid}', false); select set_config('test.super', '${sup ? "on" : "off"}', false)`);
const queue = async (db: PGlite, s = "PENDING") => (await db.query<{ r: any[] }>(`select public.qb_admin_sponsor_queue('${s}') as r`)).rows[0].r;

describe("sponsor verification", () => {
  it("lists pending sponsors with the contact email for a super administrator only", async () => {
    const db = await setup();
    await as(db, SPUSER, false);
    await expect(queue(db)).rejects.toThrow(/SUPER_ADMIN_REQUIRED/);
    await as(db, ADMIN, true);
    const r = await queue(db);
    expect(r).toHaveLength(1);   // the individual (a parent) is not in the organisation queue
    expect(r[0]).toMatchObject({ organization_name: "Akwaaba Foundation", email: "sponsor@x.test", verification_status: "PENDING" });
  });
  it("verifies, tells the sponsor, audits, and moves the sponsor out of the pending list", async () => {
    const db = await setup(); await as(db, ADMIN, true);
    await db.exec(`select public.qb_admin_sponsor_decide('${SP}', 'verified')`);
    expect(await queue(db)).toEqual([]);
    expect((await queue(db, "VERIFIED"))[0]).toMatchObject({ verification_status: "VERIFIED" });
    expect((await db.query("select title from public.notifications where recipient_user_id = '" + SPUSER + "'")).rows[0]).toEqual({ title: "Your organisation is verified" });
    expect((await db.query("select action from public.audit_log")).rows[0]).toEqual({ action: "sponsor.verification" });
  });
  it("needs a real reason to decline and keeps the reason for the sponsor to read", async () => {
    const db = await setup(); await as(db, ADMIN, true);
    await expect(db.exec(`select public.qb_admin_sponsor_decide('${SP}', 'REJECTED', 'no')`)).rejects.toThrow(/REASON_REQUIRED/);
    await db.exec(`select public.qb_admin_sponsor_decide('${SP}', 'REJECTED', 'We could not find a registration for this organisation.')`);
    expect((await queue(db, "REJECTED"))[0].verification_note).toMatch(/registration/);
  });
  it("refuses an ordinary user, an unknown decision and an unknown sponsor", async () => {
    const db = await setup(); await as(db, SPUSER, false);
    await expect(db.exec(`select public.qb_admin_sponsor_decide('${SP}', 'VERIFIED')`)).rejects.toThrow(/SUPER_ADMIN_REQUIRED/);
    await as(db, ADMIN, true);
    await expect(db.exec(`select public.qb_admin_sponsor_decide('${SP}', 'MAYBE')`)).rejects.toThrow(/INVALID_DECISION/);
    await expect(db.exec(`select public.qb_admin_sponsor_decide('00000000-0000-0000-0000-00000000dead', 'VERIFIED')`)).rejects.toThrow(/SPONSOR_NOT_FOUND/);
  });
  it("can be put back to pending without a notification and is safe to run twice", async () => {
    const db = await setup(); await as(db, ADMIN, true); await db.exec(SQL);
    await db.exec(`select public.qb_admin_sponsor_decide('${SP}', 'PENDING')`);
    expect((await db.query("select count(*)::int as n from public.notifications")).rows[0]).toEqual({ n: 0 });
  });
});
