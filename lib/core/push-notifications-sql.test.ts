import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Web push subscriptions and the pending/report cycle (isolated PostgreSQL; the migration is applied unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261025100000_push_notifications.sql");
const ROLLBACK = read("../../supabase/rollback/push_notifications.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [LEARNER, TEACHER, CHILD, STRANGER] = [1, 2, 3, 4].map(id);
let db: PGlite;
const as = async (user: string | null | "service") => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user && user !== "service" ? user : ""]);
  await db.exec(user === "service" ? "set role service_role" : user ? "set role authenticated" : "set role anon");
};
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(sql, params)).rows[0] ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
const key = (n: number) => "k".repeat(30) + n, secret = (n: number) => "s".repeat(12) + n;
const subscribe = (user: string, n: number) => as(user).then(() => rpc("select public.qb_push_subscribe($1,$2,$3,'Chrome on Android')", [`https://push.example.com/send/${n}`, key(n), secret(n)]));
const note = async (user: string, title: string, extra = "") => { await db.exec("reset role"); await db.query(`insert into public.notifications(recipient_user_id, title, message, link) values ($1,$2,'A message',$3)`, [user, title, extra || "/play"]); };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, full_name text, email text);
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, managed_by uuid);
    create table public.notifications(id uuid primary key default gen_random_uuid(), recipient_user_id uuid, title text not null, message text not null, link text, read_at timestamptz, created_at timestamptz not null default now());
    insert into public.profiles values ('${LEARNER}','STUDENT','active','Kofi','k@example.com'),('${TEACHER}','TEACHER','active','Efua','e@example.com'),('${CHILD}','STUDENT','active','Ama',null),('${STRANGER}','STUDENT','suspended','Sus','s@example.com');
    insert into public.student_profiles(user_id, managed_by) values ('${CHILD}','${TEACHER}');
  `);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("web push", () => {
  it("re-applies cleanly", async () => { await db.exec(MIGRATION); });

  it("lets a signed-in person register and remove their own devices; managed learners and suspended accounts are refused", async () => {
    expect((await subscribe(LEARNER, 1)).devices).toBe(1);
    expect((await subscribe(LEARNER, 2)).devices).toBe(2);
    expect(await rpc("select public.qb_push_status()")).toEqual({ allowed: true, devices: 2 });
    await as(CHILD); await fails("select public.qb_push_subscribe('https://push.example.com/send/9',$1,$2)", [key(9), secret(9)], /PUSH_NOT_ALLOWED/);
    expect(await rpc("select public.qb_push_status()")).toMatchObject({ allowed: false });
    await as(STRANGER); await fails("select public.qb_push_subscribe('https://push.example.com/send/8',$1,$2)", [key(8), secret(8)], /PUSH_NOT_ALLOWED/);
    await as(null); await fails("select public.qb_push_status()", [], /permission denied/);
    await as(LEARNER); await fails("select public.qb_push_subscribe('http://insecure.example.com/x',$1,$2)", [key(7), secret(7)], /check|violates/);
    await fails("select * from public.push_subscriptions", [], /permission denied/);                    // tables are not readable directly
    expect((await rpc("select public.qb_push_unsubscribe('https://push.example.com/send/2')")).devices).toBe(1);
    await as(TEACHER); expect((await rpc("select public.qb_push_unsubscribe('https://push.example.com/send/1')")).devices).toBe(0);    // someone else's device is not touched
    await as(LEARNER); expect((await rpc("select public.qb_push_status()")).devices).toBe(1);
  });

  it("keeps five devices per person and moves a device that signs in as someone else", async () => {
    await as(TEACHER); for (let n = 20; n < 27; n++) await subscribe(TEACHER, n);
    expect((await rpc("select public.qb_push_status()")).devices).toBe(5);
    await subscribe(LEARNER, 26);                                       // the same phone now belongs to the learner
    await as(TEACHER); expect((await rpc("select public.qb_push_status()")).devices).toBe(4);
    await as(LEARNER); expect((await rpc("select public.qb_push_status()")).devices).toBe(2);
  });

  it("offers only unread, recent, unpushed notifications with the owner's devices, to the server role only", async () => {
    await db.exec("reset role"); await db.exec("delete from public.notifications");
    await note(LEARNER, "Prize won"); await note(TEACHER, "No devices here"); await note(CHILD, "For a child");
    await db.exec("reset role");
    await db.exec(`insert into public.notifications(recipient_user_id, title, message, read_at) values ('${LEARNER}','Already read','m', now());
                   insert into public.notifications(recipient_user_id, title, message, created_at) values ('${LEARNER}','Too old','m', now() - interval '3 days')`);
    await as("service");
    const pending = await rpc("select public.qb_push_pending(50)");
    expect(pending.map((p: any) => p.title)).toEqual(["Prize won", "No devices here", "For a child"]);
    expect(pending[0].subscriptions.length).toBe(2); expect(pending[1].subscriptions.length).toBeGreaterThan(0); expect(pending[2].subscriptions).toEqual([]);
    for (const role of ["anon", "authenticated"] as const) { await db.exec("reset role"); await db.exec(`set role ${role}`); await fails("select public.qb_push_pending(10)", [], /permission denied/); }
  });

  it("records the outcome: finished notifications are not offered again, dead devices go, repeated failures remove a device", async () => {
    await as("service");
    const pending = await rpc("select public.qb_push_pending(50)");
    const prize = pending.find((p: any) => p.title === "Prize won");
    const [first, second] = prize.subscriptions.map((s: any) => s.id);
    await rpc("select public.qb_push_report($1,$2,$3,$4)", [pending.map((p: any) => p.notification_id), [first], [second], []]);
    expect(await rpc("select public.qb_push_pending(50)")).toEqual([]);
    await db.exec("reset role"); expect((await db.query<any>("select count(*)::int n from public.push_subscriptions where id = $1", [second])).rows[0].n).toBe(0);
    expect((await db.query<any>("select last_success_at is not null as ok, failures from public.push_subscriptions where id = $1", [first])).rows[0]).toEqual({ ok: true, failures: 0 });
    await as("service");
    for (let i = 0; i < 5; i++) await rpc("select public.qb_push_report('{}','{}','{}',$1)", [[first]]);
    await db.exec("reset role"); expect((await db.query<any>("select count(*)::int n from public.push_subscriptions where id = $1", [first])).rows[0].n).toBe(0);
  });

  it("the rollback removes everything", async () => {
    await db.exec("reset role"); await db.exec(ROLLBACK);
    expect(await rpc("select count(*)::int from pg_proc where proname like 'qb_push_%'")).toBe(0);
    expect(await rpc("select to_regclass('public.push_subscriptions') is null")).toBe(true);
    await db.exec(MIGRATION);
  });
});
