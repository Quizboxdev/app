import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261018150000_public_interest_intake.sql");
const ROLLBACK = read("../../supabase/rollback/public_interest_intake.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const H = (c: string) => c.repeat(64);                                  // a 64-hex client hash
let db: PGlite;
const as = (n: number, caps = "") => db.exec(`select set_config('request.jwt.claim.sub','${n ? id(n) : ""}',false), set_config('test.caps','${caps}',false)`);
const one = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0] ?? {};
const valid = (over: Record<string, unknown> = {}) => ({ category: "CONTACT", name: "Ama Mensah", email: "Ama@Example.com", message: "Hello QuizBox", consent: true, metadata: { enquiry_type: "General enquiry" }, ...over });
const submit = (p: Record<string, unknown>, hash = H("a")) => one("select public.qb_submit_public_interest($1::jsonb, $2) id", [JSON.stringify(p), hash]);

// users: 1 owner (super_admin), 2 support staff (sme_support), 3 ordinary signed-in user
describe("public enquiry intake (isolated PostgreSQL)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role; create schema auth; create schema quizbox_private; create schema quizbox_market; create schema quizbox_sme;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function quizbox_sme.has_capability(p text) returns boolean language sql stable as $$ select position(p in coalesce(current_setting('test.caps',true),'')) > 0 $$;
      create function quizbox_market.is_super() returns boolean language sql stable as $$ select quizbox_sme.has_capability('super_admin') $$;
      create table public.profiles(id uuid primary key);
      insert into public.profiles values('${id(1)}'),('${id(2)}'),('${id(3)}');
    `);
    await db.exec(MIGRATION);
  }, 60_000);
  afterAll(async () => { await db.close(); });

  it("stores a valid enquiry with the email lower-cased, consent stamped by the server and no raw address", async () => {
    const r = await submit(valid());
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    const row = await one("select email, status, consent_at is not null as consented, client_hash from quizbox_private.public_interest_submissions");
    expect(row).toMatchObject({ email: "ama@example.com", status: "NEW", consented: true, client_hash: H("a") });
  });

  it("rejects bad input: category, missing consent, forbidden metadata, non-text metadata, bad hash, bad email, oversized message", async () => {
    await expect(submit(valid({ category: "HACK" }), H("b"))).rejects.toThrow("QB_INTAKE_INVALID");
    await expect(submit(valid({ consent: false }), H("b"))).rejects.toThrow("QB_INTAKE_CONSENT_REQUIRED");
    await expect(submit(valid({ metadata: { role: "x" } }), H("b"))).rejects.toThrow("QB_INTAKE_INVALID");           // a COUNTRY key on a CONTACT form
    await expect(submit(valid({ metadata: { enquiry_type: { nested: 1 } } }), H("b"))).rejects.toThrow("QB_INTAKE_INVALID");
    await expect(submit(valid(), "not-a-hash")).rejects.toThrow("QB_INTAKE_INVALID");
    await expect(submit(valid({ email: "nope" }), H("b"))).rejects.toThrow();
    await expect(submit(valid({ message: "x".repeat(2001) }), H("b"))).rejects.toThrow();
  });

  it("enforces the durable limits: per client per hour, and per email per category per day", async () => {
    for (let i = 0; i < 4; i++) await submit(valid({ email: `p${i}@example.com` }), H("c"));          // 4 more from client c: 5 in the hour in total with the next
    await submit(valid({ email: "p4@example.com" }), H("c"));
    await expect(submit(valid({ email: "p5@example.com" }), H("c"))).rejects.toThrow("QB_RATE_LIMITED");   // the 6th from one client
    for (let i = 0; i < 3; i++) await submit(valid({ email: "same@example.com" }), H(String(i)));
    await expect(submit(valid({ email: "same@example.com" }), H("9"))).rejects.toThrow("QB_RATE_LIMITED");  // the 4th for one email and category
  });

  it("is writable by the server only: no table access and no function access for browsers", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select * from quizbox_private.public_interest_submissions")).rejects.toThrow();
      await expect(db.query("select public.qb_submit_public_interest('{}'::jsonb, 'x')")).rejects.toThrow();
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    expect((await submit(valid({ email: "svc@example.com" }), H("d"))).id).toBeTruthy();
    await db.exec("reset role");
  });

  it("lets super admin and support staff list and review, and nobody else; the client hash never leaves", async () => {
    await as(3);
    await expect(one("select public.qb_admin_public_interest('list') v")).rejects.toThrow("SUPPORT_ACCESS_REQUIRED");
    await as(0);
    await expect(one("select public.qb_admin_public_interest('list') v")).rejects.toThrow("SUPPORT_ACCESS_REQUIRED");
    await as(2, "sme_support");
    const list = (await one("select public.qb_admin_public_interest('list', '{\"limit\": 500}') v")).v;
    expect(list.length).toBeGreaterThan(5); expect(list.length).toBeLessThanOrEqual(200);
    expect(list[0].client_hash).toBeUndefined();
    const first = list[list.length - 1].id;
    expect((await one("select public.qb_admin_public_interest('review', $1::jsonb) v", [JSON.stringify({ id: first, status: "contacted", note: "Called back" })])).v).toEqual({ ok: true });
    await expect(one("select public.qb_admin_public_interest('review', $1::jsonb) v", [JSON.stringify({ id: first, status: "NEW" })])).rejects.toThrow("QB_INTAKE_INVALID");
    expect((await one("select public.qb_admin_public_interest('counts') v")).v.total).toBeGreaterThan(5);
    expect(await one("select status, review_note, reviewed_by from quizbox_private.public_interest_submissions where id = $1", [first])).toMatchObject({ status: "CONTACTED", review_note: "Called back", reviewed_by: id(2) });
    await as(1, "super_admin");
    expect((await one("select public.qb_admin_public_interest('list', '{\"category\": \"contact\", \"status\": \"contacted\"}') v")).v).toHaveLength(1);
  });

  it("purges by the retention rule, for the owner only", async () => {
    await db.exec(`update quizbox_private.public_interest_submissions set status = 'CLOSED', reviewed_at = now() - interval '25 months' where email = 'p0@example.com';
                   update quizbox_private.public_interest_submissions set status = 'SPAM', created_at = now() - interval '91 days' where email = 'p1@example.com';
                   update quizbox_private.public_interest_submissions set status = 'CLOSED', reviewed_at = now() - interval '2 months' where email = 'p2@example.com'`);
    await as(2, "sme_support");
    await expect(one("select public.qb_admin_public_interest('purge') v")).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(1, "super_admin");
    expect((await one("select public.qb_admin_public_interest('purge') v")).v).toEqual({ deleted: 2 });                // old closed + old spam; the recent closed one stays
  });

  it("rolls back, refusing while submissions exist", async () => {
    await expect(db.exec(ROLLBACK)).rejects.toThrow("QB_ROLLBACK_REFUSED");
    await db.exec("rollback");                                                       // the refused rollback left its transaction open; undo it (nothing was dropped)
    expect((await one("select to_regclass('quizbox_private.intake_budgets') t")).t).toBeTruthy();
    await db.exec("delete from quizbox_private.public_interest_submissions");
    await db.exec(ROLLBACK);
    expect((await db.query("select to_regclass('quizbox_private.public_interest_submissions') t")).rows[0]).toEqual({ t: null });
  });
});
