import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Teacher-managed learners under 13 (isolated PostgreSQL; the core platform migration is applied unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const CORE = read("../../supabase/migrations/20261007100000_core_platform_foundation.sql");
const INTAKE = read("../../supabase/migrations/20261018150000_public_interest_intake.sql");
const MANAGED = read("../../supabase/migrations/20261019150000_managed_learners.sql");
const ERASE = read("../../supabase/migrations/20261020100000_managed_learner_erasure.sql");
const ERASE_ROLLBACK = read("../../supabase/rollback/managed_learner_erasure.sql");
const LIFECYCLE = read("../../supabase/migrations/20261024100000_managed_learner_lifecycle.sql");
const LIFECYCLE_ROLLBACK = read("../../supabase/rollback/managed_learner_lifecycle.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ADMIN, FIN, GUARDIAN, WARD, SPONSOR, STRANGER, TEACHER] = [1, 2, 3, 4, 5, 6, 7].map(id);
const OWNER = id(1), OTHER_TEACHER = id(8), CLASS = id(600), CHILD1 = id(801), CHILD2 = id(802);
let db: PGlite;
const as = (user: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
const q = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0];
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await q(sql, params)) ?? {})[0] as any;
const provision = (teacher: string, user: string, name = "Ama", username = "ama.k7f2", consent = "Consent forms signed Oct 2026") =>
  rpc("select public.qb_managed_learner_provision($1,$2,$3,$4,$5,$6)", [teacher, CLASS, user, name, username, consent]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;
    create table public.profiles(id uuid primary key,role text,status text,onboarding_completed_at timestamptz, email text, full_name text, country text, school_name text, default_market_id uuid, primary_market_id uuid);
    create table public.currencies(code text primary key);
    create table public.institutions(id uuid primary key,name text);
    create table public.institution_memberships(id uuid primary key default gen_random_uuid(),institution_id uuid,user_id uuid,role text,status text);
    create table public.user_capabilities(user_id uuid not null,capability text not null constraint user_capabilities_capability_check check (capability in ('super_admin','content_admin')),active boolean default true,primary key(user_id,capability));
    create table public.audit_logs(id uuid primary key default gen_random_uuid(),actor_user_id uuid,action text,entity_type text,entity_id uuid,status text,details jsonb,created_at timestamptz default now());
    create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_user_id uuid);
    create table public.attempts(id uuid primary key default gen_random_uuid());
    create table public.responses(id uuid primary key default gen_random_uuid());
    -- Hosted-shape stand-ins: both tables already exist in production and the migration must coexist with them.
    create table public.entitlements(id uuid primary key default gen_random_uuid(),user_id uuid,product text,status text);
    create table public.notification_deliveries(id uuid primary key default gen_random_uuid(),notification_id uuid,channel text,status text);
    -- Stand-ins for objects the migration replaces/relies on (production definitions: 20261002200000, 20261004110000, 20261006110000/120000).
    create schema quizbox_sme; create schema quizbox_ops;
    create function quizbox_sme.has_capability(p text) returns boolean language sql stable security definer as $$
      select auth.uid() is not null and (exists(select 1 from public.profiles where id=auth.uid() and lower(role)='owner')
        or exists(select 1 from public.user_capabilities where user_id=auth.uid() and active and capability in ('super_admin',p))) $$;
    create function quizbox_ops.analytics_student(p_student uuid) returns uuid language plpgsql stable security definer as $$
      declare v uuid:=coalesce(p_student,auth.uid()); begin if auth.uid() is null or (v<>auth.uid() and not quizbox_sme.has_capability('super_admin')) then raise exception 'NOT_AUTHORIZED'; end if; return v; end $$;
    create function quizbox_ops.student_insights(p uuid) returns jsonb language sql stable security definer as $$ select jsonb_build_object('learner',p) $$;
    create function public.qb_student_insights() returns jsonb language sql stable security definer as $$ select quizbox_ops.student_insights(auth.uid()) $$;
    create function public.qb_student_achievements(p_student_id uuid default auth.uid()) returns jsonb language plpgsql stable security definer as $$
      declare s uuid:=quizbox_ops.analytics_student(p_student_id); begin return jsonb_build_object('learner',s); end $$;
    grant usage on schema quizbox_sme, quizbox_ops to authenticated;
    grant execute on function quizbox_sme.has_capability(text) to authenticated;
    grant execute on function public.qb_student_achievements(uuid) to authenticated;
    grant select on public.profiles, public.institutions, public.institution_memberships, public.user_capabilities, public.notifications to authenticated;
    insert into public.currencies values('GHS');
    insert into public.profiles values('${ADMIN}','OWNER','active',now()),('${FIN}','STUDENT','active',now()),('${GUARDIAN}','STUDENT','active',now()),
      ('${WARD}','STUDENT','active',now()),('${SPONSOR}','SPONSOR','active',now()),('${STRANGER}','STUDENT','active',now()),('${TEACHER}','TEACHER','active',null);
    insert into public.user_capabilities values('${FIN}','content_admin');
  `);
  await db.exec(CORE);
  await db.exec(`
    create table auth.users(id uuid primary key, email text);
    create function public.qb_is_platform_admin() returns boolean language sql stable as $$ select false $$;
    create table public.classes(id uuid primary key, class_name text, school_name text, grade text, grade_label text, status text default 'active', teacher_user_id uuid);
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid unique, grade text, school_name text, country text, status text default 'active', created_at timestamptz default now());
    create table public.class_memberships(id uuid primary key default gen_random_uuid(), class_id uuid, student_id uuid, student_user_id uuid, student_email text, student_name text, grade text, status text default 'active', approved_at timestamptz);
    create table public.user_market_memberships(user_id uuid, market_id uuid, active boolean, primary key(user_id, market_id));
    create schema quizbox_private;
  `);
  await db.exec(INTAKE.slice(INTAKE.indexOf("create table if not exists quizbox_private.intake_budgets"), INTAKE.indexOf("-- Per-category metadata allowlist")));
  await db.exec(`insert into auth.users values ('${CHILD1}','ama.k7f2@learners.quizbox.io'),('${CHILD2}','kofi.m3x9@learners.quizbox.io')`);
  await db.exec(`insert into public.profiles(id,role,status,onboarding_completed_at,email,full_name,country,school_name) values ('${OTHER_TEACHER}','TEACHER','active',now(),'t2@example.com','Other','Ghana','Elsewhere')
    on conflict do nothing`);
  await db.exec(`update public.profiles set email='teacher@example.com', full_name='Teacher', country='Ghana' where id='${TEACHER}'`);
  await db.exec(`insert into public.classes values ('${CLASS}','B4 Gold','St Mary''s','B4','Basic 4','active','${TEACHER}')`);
  await db.exec(MANAGED);
  await db.exec("alter table public.profiles add column phone text; create schema if not exists quizbox_market; create or replace function quizbox_market.is_super() returns boolean language sql stable as $$ select auth.uid() = '" + OWNER + "'::uuid $$");
  await db.exec(ERASE);
  await db.exec(LIFECYCLE);
});
afterAll(async () => { await db.close(); });

describe("erasing a managed learner's personal data", () => {
  it("removes everything that identifies the child and keeps the learning records", async () => {
    await provision(TEACHER, CHILD1, "Ama", "ama.k7f2");
    await db.exec(`insert into public.audit_logs(actor_user_id, action) values ('${CHILD1}', 'practice')`);
    const r = await rpc("select public.qb_managed_learner_erase($1, 'Written request from the parent, 20 Oct 2026')", [CHILD1]);
    expect(r).toMatchObject({ erased: true, already: false, login_email: "erased-00000000@erased.invalid" });
    expect(await q("select full_name, email, school_name, status from public.profiles where id = $1", [CHILD1])).toEqual({ full_name: "Former learner", email: "erased-00000000@erased.invalid", school_name: null, status: "inactive" });
    expect(await q("select student_name, student_email, status from public.class_memberships where student_user_id = $1", [CHILD1])).toEqual({ student_name: "Former learner", student_email: "erased-00000000@erased.invalid", status: "inactive" });
    expect(await q("select school_name, status, erased_at is not null as erased, archived_at is not null as ended from public.student_profiles where user_id = $1", [CHILD1])).toEqual({ school_name: null, status: "inactive", erased: true, ended: true });
    expect((await q("select policy_ref from public.learner_consent where user_id = $1", [CHILD1])).policy_ref).toBe("erased");
    expect((await q("select count(*)::int n from public.audit_logs where actor_user_id = $1", [CHILD1])).n).toBe(1);                // activity rows are kept, now unidentifiable
    expect(JSON.stringify(await q("select details from public.audit_logs where action = 'QB_MANAGED_LEARNER_ERASED' and entity_id = $1", [CHILD1]))).not.toContain("ama.k7f2");
  });

  it("is repeatable, refuses ordinary learners and a missing reason, and is for the server role only", async () => {
    expect(await rpc("select public.qb_managed_learner_erase($1, 'repeat request ok')", [CHILD1])).toEqual({ erased: true, already: true });
    await expect(q("select public.qb_managed_learner_erase($1, 'a real reason here')", [WARD])).rejects.toThrow("QB_MANAGED_LEARNER_NOT_FOUND");
    await provision(TEACHER, CHILD2, "Kofi", "kofi.m3x9");
    await expect(q("select public.qb_managed_learner_erase($1, 'no')", [CHILD2])).rejects.toThrow("QB_ERASURE_REASON_REQUIRED");
    for (const role of ["anon", "authenticated"]) { await db.exec(`set role ${role}`); await expect(db.query("select public.qb_managed_learner_erase($1, 'a real reason here')", [CHILD2])).rejects.toThrow(); await db.exec("reset role"); }
  });

  it("lets only the owner find a learner by username, and lists ended accounts past 12 months", async () => {
    await as(TEACHER); await expect(q("select public.qb_managed_learner_find('kofi.m3x9')")).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await expect(q("select public.qb_managed_erasure_queue()")).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(OWNER);
    expect(await rpc("select public.qb_managed_learner_find(' KOFI.m3x9 ')")).toEqual([expect.objectContaining({ user_id: CHILD2, first_name: "Kofi", username: "kofi.m3x9", erased: false })]);
    expect(await rpc("select public.qb_managed_learner_find('nobody')")).toEqual([]);
    expect(await rpc("select public.qb_managed_erasure_queue()")).toEqual([]);                                                     // nobody has ended yet
    await db.exec(`update public.student_profiles set status = 'inactive', archived_at = now() - interval '13 months' where user_id = '${CHILD2}'`);
    expect(await rpc("select public.qb_managed_erasure_queue()")).toEqual([expect.objectContaining({ user_id: CHILD2, first_name: "Kofi", username: "kofi.m3x9" })]);
    await db.exec(`update public.student_profiles set archived_at = now() - interval '3 months' where user_id = '${CHILD2}'`);
    expect(await rpc("select public.qb_managed_erasure_queue()")).toEqual([]);                                                     // ended, but inside the retention period
  });

  it("keeps a retention setting, lists a school-wide overview and only the owner can see it", async () => {
    await db.exec(`update public.student_profiles set status = 'inactive', archived_at = now() - interval '8 months' where user_id = '${CHILD2}'`);
    await as(TEACHER); await expect(q("select public.qb_managed_overview()")).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(OWNER);
    const o = await rpc("select public.qb_managed_overview()");
    expect(o).toMatchObject({ auto_erase: false, retention_months: 12 });
    expect(o.classes).toEqual([expect.objectContaining({ school: "St Mary's", class_name: "B4 Gold", teacher_name: "Teacher", active: 0, ended: 1, erased: 1, due: 0 })]);
    await db.exec("update public.platform_settings set value = '6'::jsonb where key = 'safety.managed_retention_months'");
    expect((await rpc("select public.qb_managed_overview()")).classes[0].due).toBe(1);                                    // 8 months old is now past a 6 month rule
    expect((await rpc("select public.qb_managed_erasure_queue()")).map((l: any) => l.username)).toEqual(["kofi.m3x9"]);
    await db.exec("update public.platform_settings set value = '1'::jsonb where key = 'safety.managed_retention_months'");
    expect((await rpc("select public.qb_managed_overview()")).retention_months).toBe(6);                                   // never below 6 months
    await db.exec("update public.platform_settings set value = '12'::jsonb where key = 'safety.managed_retention_months'");
  });

  it("scheduled erasure is off by default, owner-switchable, and the due list is for the server role only", async () => {
    await db.exec(`update public.student_profiles set archived_at = now() - interval '13 months' where user_id = '${CHILD2}'`);
    await db.exec("set role service_role");
    expect(await rpc("select public.qb_managed_erasure_due()")).toEqual([]);                                                // switch is off
    await db.exec("reset role"); await as(TEACHER); await expect(q("select public.qb_managed_set_auto_erase(true)")).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(OWNER); expect(await rpc("select public.qb_managed_set_auto_erase(true)")).toEqual({ auto_erase: true });
    await expect(q("select public.qb_managed_set_auto_erase(null)")).rejects.toThrow("INVALID_VALUE");
    await db.exec("reset role"); await db.exec("set role service_role");
    expect(await rpc("select public.qb_managed_erasure_due(10)")).toEqual([{ user_id: CHILD2, ended_at: expect.any(String), months: 12 }]);
    for (const role of ["anon", "authenticated"]) { await db.exec("reset role"); await db.exec(`set role ${role}`); await expect(db.query("select public.qb_managed_erasure_due(10)")).rejects.toThrow(/permission denied/); }
    await db.exec("reset role"); expect((await q("select count(*)::int n from public.audit_logs where action = 'QB_MANAGED_AUTO_ERASE_SET'")).n).toBe(1);
    await as(OWNER); await rpc("select public.qb_managed_set_auto_erase(false)");
  });

  it("moves a leaving teacher's learners and classes to another teacher, owner only", async () => {
    await db.exec("reset role");
    await as(TEACHER); await expect(q("select public.qb_managed_reassign('teacher@example.com','t2@example.com')")).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(OWNER);
    await expect(q("select public.qb_managed_reassign('teacher@example.com','nobody@example.com')")).rejects.toThrow("TEACHER_NOT_FOUND");
    await expect(q("select public.qb_managed_reassign('teacher@example.com','teacher@example.com')")).rejects.toThrow("SAME_TEACHER");
    expect(await rpc("select public.qb_managed_reassign('teacher@example.com','t2@example.com', false)")).toEqual({ learners: 2, classes: 0 });   // learners only
    expect((await q("select teacher_user_id from public.classes where id = $1", [CLASS])).teacher_user_id).toBe(TEACHER);
    expect((await q("select count(*)::int n from public.student_profiles where managed_by = $1", [OTHER_TEACHER])).n).toBe(2);
    expect(await rpc("select public.qb_managed_reassign('teacher@example.com','t2@example.com')")).toEqual({ learners: 0, classes: 1 });          // now the class follows
    expect((await q("select teacher_user_id from public.classes where id = $1", [CLASS])).teacher_user_id).toBe(OTHER_TEACHER);
    expect((await q("select details from public.audit_logs where action = 'QB_MANAGED_REASSIGNED' order by created_at desc limit 1")).details).toMatchObject({ learners: 0, classes: 1 });
  });

  it("rolls back the lifecycle functions and restores the fixed 12 month queue", async () => {
    await db.exec(LIFECYCLE_ROLLBACK);
    expect((await q("select to_regprocedure('public.qb_managed_overview()') f")).f).toBeNull();
    expect((await q("select count(*)::int n from public.platform_settings where key like 'safety.managed_%retention%' or key = 'safety.managed_auto_erase'")).n).toBe(0);
    await as(OWNER); expect(await rpc("select public.qb_managed_erasure_queue()")).toEqual([expect.objectContaining({ username: "kofi.m3x9" })]);
    await db.exec("reset role"); await db.exec(LIFECYCLE);
  });

  it("rolls back the functions without restoring erased data", async () => {
    await db.exec(ERASE_ROLLBACK);
    expect((await q("select to_regprocedure('public.qb_managed_learner_erase(uuid,text)') f")).f).toBeNull();
    expect((await q("select full_name from public.profiles where id = $1", [CHILD1])).full_name).toBe("Former learner");
  });
});
