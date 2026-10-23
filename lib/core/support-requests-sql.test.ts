import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Support requests: people and visitors ask, staff answer, files are authorised (isolated PostgreSQL; the migration is applied unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261038100000_support_requests.sql");
const ROLLBACK = read("../../supabase/rollback/support_requests.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, ADMIN, SUPPORT, STUDENT, STUDENT2, TEACHER] = [1, 2, 3, 4, 5, 6].map(id);
let db: PGlite;
const as = async (user: string | "service" | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user && user !== "service" ? user : ""]);
  await db.exec(user === "service" ? "set role service_role" : user ? "set role authenticated" : "set role anon");
};
const q = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0];
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await q(sql, params)) ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
// The tables are closed to every browser role, so checks that read them directly run as the database owner and then switch back.
const owner = async (sql: string, params: unknown[], back: string | "service" | null) => { await db.exec("reset role"); const r = await rpc(sql, params); await as(back); return r; };
const create = (cat = "account", subject = "I cannot sign in", message = "I forgot my password and the email never arrives.", ctx = "") =>
  rpc("select public.qb_support_create($1,$2,$3,$4)", [cat, subject, message, ctx]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, full_name text, email text);
    create table public.user_capabilities(user_id uuid not null, capability text not null, active boolean not null default true);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, details jsonb);
    create table public.notifications(id uuid primary key default gen_random_uuid(), recipient_user_id uuid);
    create schema quizbox_core;
    create function quizbox_core.is_staff(p_roles text[] default array['super_admin','platform_admin']) returns boolean language sql stable security definer as $$
      select auth.uid() is not null and (exists(select 1 from public.profiles where id=auth.uid() and lower(role)='owner') or exists(select 1 from public.user_capabilities where user_id=auth.uid() and active and capability = any(p_roles))) $$;
    create function quizbox_core.audit(p_action text, p_entity_type text, p_entity uuid, p_details jsonb default '{}') returns void language sql security definer as $$
      insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, details) values (auth.uid(), p_action, p_entity_type, p_entity, p_details) $$;
    create schema quizbox_private;
    create table quizbox_private.budget_hits(key text, at timestamptz default now());
    create function quizbox_private.consume_intake_budget(p_key text, p_limit integer, p_seconds integer) returns boolean language plpgsql security definer as $$
      begin if (select count(*) from quizbox_private.budget_hits where key = p_key and at > now() - make_interval(secs => p_seconds)) >= p_limit then return false; end if;
        insert into quizbox_private.budget_hits(key) values (p_key); return true; end $$;
    grant usage on schema quizbox_core, quizbox_private to authenticated, service_role;
    grant execute on function quizbox_core.is_staff(text[]), quizbox_core.audit(text, text, uuid, jsonb), quizbox_private.consume_intake_budget(text, integer, integer) to authenticated, service_role;
    insert into public.profiles values ('${OWNER}','OWNER','active','Owner','o@example.com'),('${ADMIN}','ADMIN','active','Ama Admin','a@example.com'),('${SUPPORT}','STUDENT','active','Sam Support','sup@example.com'),
      ('${STUDENT}','STUDENT','active','Kofi Mensah','k@example.com'),('${STUDENT2}','STUDENT','active','Esi Owusu','e@example.com'),('${TEACHER}','TEACHER','active','Tina Teacher','t@example.com');
    insert into public.user_capabilities values ('${SUPPORT}','sme_support',true);
  `);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("support requests", () => {
  it("re-applies cleanly, and the tables are closed to every browser", async () => {
    await db.exec(MIGRATION);
    await as(STUDENT);
    await fails("select * from public.support_requests", [], /permission denied/);
    await fails("select * from public.support_request_messages", [], /permission denied/);
    await fails("select * from public.support_request_files", [], /permission denied/);
    await fails("insert into public.support_requests(requester_name, requester_email, category, subject) values ('x','x@y.zz','other','abc')", [], /permission denied/);
  });

  it("a signed-in person opens a request, with a reference, and sees only their own", async () => {
    await as(STUDENT);
    const r = await create("payment", "I was charged twice", "Two GHS 10 charges for one plan, please help.", "help:refunds");
    expect(r.reference).toMatch(/^QB-T-[0-9A-F]{10}$/);
    await as(STUDENT2); await create("class", "Cannot join my class", "The class code says it has expired.");
    await as(STUDENT);
    const mine = await rpc("select public.qb_support_my_requests()");
    expect(mine).toHaveLength(1); expect(mine[0]).toMatchObject({ subject: "I was charged twice", category: "payment", status: "open" });
    const got = await rpc("select public.qb_support_request_get($1)", [r.id]);
    expect(got.request).toMatchObject({ reference: r.reference, requester_name: "Kofi Mensah", requester_email: "k@example.com", mine: true, staff_view: false, context: "help:refunds" });
    expect(got.request.requester_user_id).toBeUndefined();
    expect(got.messages).toHaveLength(1);
    await as(STUDENT2); await fails("select public.qb_support_request_get($1)", [r.id], /QB_NOT_FOUND/);       // nobody else can open it
    await as(null); await fails("select public.qb_support_my_requests()", [], /permission denied/);
  });

  it("refuses an invalid request", async () => {
    await as(STUDENT);
    await fails("select public.qb_support_create('nonsense','A subject','A long enough message here')", [], /QB_SUPPORT_INVALID/);
    await fails("select public.qb_support_create('other','ab','A long enough message here')", [], /QB_SUPPORT_INVALID/);
    await fails("select public.qb_support_create('other','A subject','too short')", [], /QB_SUPPORT_INVALID/);
  });

  it("limits a person to 10 new requests an hour", async () => {
    await as(TEACHER);
    for (let i = 0; i < 10; i++) await create("other", `Question number ${i}`, "A question that is long enough to count.");
    await fails("select public.qb_support_create('other','One too many','A question that is long enough to count.')", [], /QB_RATE_LIMITED/);
  });

  it("lets visitors write through the server only, with limits per device and per email", async () => {
    await as(STUDENT); await fails("select public.qb_support_create_public('A','a@b.co','other','Hello there','A message that is long enough.','h1')", [], /permission denied/);
    await as(null); await fails("select public.qb_support_create_public('A','a@b.co','other','Hello there','A message that is long enough.','h1')", [], /permission denied/);
    await as("service");
    const v = await rpc("select public.qb_support_create_public('Visitor One','Visitor@Example.com','payment','Duplicate charge','I was charged twice yesterday.','hash-a')");
    expect(v.reference).toMatch(/^QB-T-/);
    expect(await owner("select requester_email from public.support_requests where id=$1", [v.id], "service")).toBe("visitor@example.com");
    await fails("select public.qb_support_create_public('V','not-an-email','other','Hello there','A message that is long enough.','hash-b')", [], /QB_SUPPORT_INVALID/);
    for (let i = 0; i < 5; i++) await rpc("select public.qb_support_create_public('V','v@example.com','other','Hello there','A message that is long enough.','hash-c')");
    await fails("select public.qb_support_create_public('V','w@example.com','other','Hello there','A message that is long enough.','hash-c')", [], /QB_RATE_LIMITED/);          // device limit (5 an hour)
    for (let i = 0; i < 4; i++) await rpc("select public.qb_support_create_public('V','same@example.com','other','Hello there','A message that is long enough.',$1)", [`hash-d${i}`]);
    await rpc("select public.qb_support_create_public('V','same@example.com','other','Hello there','A message that is long enough.','hash-e')");
    await fails("select public.qb_support_create_public('V','same@example.com','other','Hello there','A message that is long enough.','hash-f')", [], /QB_RATE_LIMITED/);        // email limit (5 a day)
  });

  it("is answered by staff only: owner, admin and support; nobody else can list or answer", async () => {
    await as(STUDENT); const r = await create("account", "Locked out", "I cannot sign in to my account at all.");
    for (const who of [STUDENT2, TEACHER]) {
      await as(who);
      await fails("select public.qb_support_admin_list()", [], /QB_FORBIDDEN/);
      await fails("select public.qb_support_staff_reply($1,'hello')", [r.id], /QB_FORBIDDEN/);
      await fails("select public.qb_support_set($1,'closed','high',null)", [r.id], /QB_FORBIDDEN/);
      await fails("select public.qb_support_delete($1)", [r.id], /QB_FORBIDDEN/);
    }
    for (const who of [OWNER, ADMIN, SUPPORT]) { await as(who); expect((await rpc("select public.qb_support_admin_list()")).some((x: any) => x.id === r.id)).toBe(true); }
  });

  it("a public answer waits for the person; an internal note stays hidden from them; the person's reply reopens it", async () => {
    await as(STUDENT); const r = await create("account", "Password email missing", "The reset email never reaches my inbox.");
    await as(SUPPORT);
    await rpc("select public.qb_support_staff_reply($1,'Internal: check the mail provider logs',true,null)", [r.id]);
    const after = await rpc("select public.qb_support_staff_reply($1,'Please check your spam folder and try again.',false,null)", [r.id]);
    expect(after).toMatchObject({ ok: true, status: "waiting_for_user" });
    const staffView = await rpc("select public.qb_support_request_get($1)", [r.id]);
    expect(staffView.messages.map((m: any) => [m.author_kind, m.internal])).toEqual([["requester", false], ["staff", true], ["staff", false]]);
    await as(STUDENT);
    const mine = await rpc("select public.qb_support_request_get($1)", [r.id]);
    expect(mine.messages.map((m: any) => m.body)).toEqual(["The reset email never reaches my inbox.", "Please check your spam folder and try again."]);
    expect(mine.request).toMatchObject({ status: "waiting_for_user", staff_view: false });
    await rpc("select public.qb_support_reply($1,'Found it in spam, thank you.')", [r.id]);
    expect((await rpc("select public.qb_support_request_get($1)", [r.id])).request.status).toBe("open");
    await as(STUDENT2); await fails("select public.qb_support_reply($1,'not mine')", [r.id], /QB_NOT_FOUND/);
  });

  it("resolving stamps the time, a closed request cannot be answered by the person, and statuses and priorities are checked", async () => {
    await as(STUDENT); const r = await create("class", "Class code", "The class code from my teacher is not accepted.");
    await as(ADMIN);
    expect(await rpc("select public.qb_support_set($1,'resolved','high',$2)", [r.id, SUPPORT])).toMatchObject({ ok: true, status: "resolved", priority: "high" });
    expect(await owner("select (resolved_at is not null) as ok from public.support_requests where id=$1", [r.id], ADMIN)).toBe(true);
    await fails("select public.qb_support_set($1,'bogus','high',null)", [r.id], /QB_SUPPORT_INVALID/);
    await fails("select public.qb_support_set($1,'open','urgent',null)", [r.id], /QB_SUPPORT_INVALID/);
    await rpc("select public.qb_support_set($1,'closed','normal',null)", [r.id]);
    await as(STUDENT); await fails("select public.qb_support_reply($1,'one more thing')", [r.id], /QB_SUPPORT_CLOSED/);
    expect(await owner("select count(*)::int from public.audit_logs where action='support.set'", [], OWNER)).toBeGreaterThanOrEqual(2);
  });

  it("authorises files: the owner of the request and staff may open them, nobody else; ten at most", async () => {
    await as(STUDENT); const r = await create("payment", "Receipt attached", "Here is my receipt from Paystack, please check.");
    await as("service");
    const msg = await owner("select id from public.support_request_messages where request_id=$1", [r.id], "service");
    const f = await rpc("select public.qb_support_file_add($1,$2,$3,'receipt.pdf','application/pdf',12345,'requester')", [r.id, msg, `${r.id}/aaaaaaaa.pdf`]);
    await fails("select public.qb_support_file_add($1,null,'x/short.exe','bad.exe','application/x-msdownload',10,'requester')", [r.id], /check/);
    await as(STUDENT);
    expect(await rpc("select public.qb_support_file_authorize($1)", [f])).toEqual({ path: `${r.id}/aaaaaaaa.pdf`, file_name: "receipt.pdf", mime: "application/pdf" });
    expect((await rpc("select public.qb_support_request_get($1)", [r.id])).messages[0].files).toEqual([{ id: f, file_name: "receipt.pdf", mime: "application/pdf", size_bytes: 12345 }]);
    await as(STUDENT2); await fails("select public.qb_support_file_authorize($1)", [f], /QB_NOT_FOUND/);
    await as(SUPPORT); expect((await rpc("select public.qb_support_file_authorize($1)", [f])).file_name).toBe("receipt.pdf");
    await as(STUDENT);
    expect(await rpc("select public.qb_support_request_authorize($1)", [r.id])).toMatchObject({ kind: "requester", files: 1 });
    await as(SUPPORT); expect((await rpc("select public.qb_support_request_authorize($1)", [r.id])).kind).toBe("staff");
    await as("service");
    for (let i = 0; i < 9; i++) await rpc("select public.qb_support_file_add($1,null,$2,'a.png','image/png',100,'requester')", [r.id, `${r.id}/extra-${i}-xxxx.png`]);
    await fails("select public.qb_support_file_add($1,null,$2,'a.png','image/png',100,'requester')", [r.id, `${r.id}/extra-9-xxxx.png`], /QB_SUPPORT_TOO_MANY_FILES/);
  });

  it("cleans a file name, and deletes a resolved request with its messages and files, returning the stored paths", async () => {
    await as(STUDENT2); const r = await create("other", "Delete me later", "A question that is long enough to count.");
    await as("service");
    const f = await rpc("select public.qb_support_file_add($1,null,$2,$3,'image/png',100,'requester')", [r.id, `${r.id}/clean-name-1.png`, "..\\evil/../name\u0007.png"]);
    expect((await owner("select file_name from public.support_request_files where id=$1", [f], "service")).includes("/")).toBe(false);
    await as(ADMIN);
    await fails("select public.qb_support_delete($1)", [r.id], /QB_SUPPORT_NOT_RESOLVED/);
    await rpc("select public.qb_support_set($1,'resolved','low',null)", [r.id]);
    expect(await rpc("select public.qb_support_delete($1)", [r.id])).toEqual({ ok: true, paths: [`${r.id}/clean-name-1.png`] });
    await db.exec("reset role");
    expect((await q("select (select count(*) from public.support_requests where id=$1)::int + (select count(*) from public.support_request_messages where request_id=$1)::int + (select count(*) from public.support_request_files where request_id=$1)::int as n", [r.id])).n).toBe(0);
  });

  it("rolls back cleanly", async () => {
    await db.exec("reset role"); await db.exec(ROLLBACK);
    expect((await q("select to_regclass('public.support_requests')::text t")).t).toBeNull();
    expect((await q("select count(*)::int n from pg_proc where proname like 'qb_support%'")).n).toBe(0);
    await db.exec(MIGRATION);
  });
});
