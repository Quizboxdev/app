import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Teacher-managed learners under 13 (isolated PostgreSQL; the core platform migration is applied unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const CORE = read("../../supabase/migrations/20261007100000_core_platform_foundation.sql");
const INTAKE = read("../../supabase/migrations/20261018150000_public_interest_intake.sql");
const MANAGED = read("../../supabase/migrations/20261019150000_managed_learners.sql");
const ROLLBACK = read("../../supabase/rollback/managed_learners.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ADMIN, FIN, GUARDIAN, WARD, SPONSOR, STRANGER, TEACHER] = [1, 2, 3, 4, 5, 6, 7].map(id);
const OTHER_TEACHER = id(8), CLASS = id(600), CHILD1 = id(801), CHILD2 = id(802);
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
});
afterAll(async () => { await db.close(); });

describe("teacher-managed learners", () => {
  it("lets only the class's teacher see its context", async () => {
    await as(TEACHER);
    expect(await rpc("select public.qb_managed_class_context($1)", [CLASS])).toMatchObject({ class_name: "B4 Gold", grade: "B4", school: "St Mary's" });
    for (const other of [OTHER_TEACHER, WARD]) { await as(other); await expect(q("select public.qb_managed_class_context($1)", [CLASS])).rejects.toThrow("QB_CLASS_NOT_MANAGED"); }
  });

  it("builds a complete learner: profile, student record, class seat and stored consent, with no email of their own", async () => {
    const r = await provision(TEACHER, CHILD1);
    expect(r).toMatchObject({ user_id: CHILD1, username: "ama.k7f2", first_name: "Ama" });
    expect(await q("select role, full_name, status, school_name, onboarding_completed_at is not null as done from public.profiles where id = $1", [CHILD1])).toEqual({ role: "student", full_name: "Ama", status: "active", school_name: "St Mary's", done: true });
    expect(await q("select grade, is_minor, managed_by from public.student_profiles where user_id = $1", [CHILD1])).toEqual({ grade: "B4", is_minor: true, managed_by: TEACHER });
    expect(await q("select class_id, student_name, status from public.class_memberships where student_user_id = $1", [CHILD1])).toEqual({ class_id: CLASS, student_name: "Ama", status: "active" });
    expect(await q("select status, policy_ref, decided_by from public.learner_consent where user_id = $1", [CHILD1])).toEqual({ status: "granted", policy_ref: "school-attested: Consent forms signed Oct 2026", decided_by: TEACHER });
    expect((await q("select count(*)::int n from public.audit_logs where action = 'QB_MANAGED_LEARNER_CREATED' and entity_id = $1", [CHILD1])).n).toBe(1);
  });

  it("refuses without a consent confirmation, for another teacher's class, and for bad names or usernames", async () => {
    await expect(provision(TEACHER, CHILD2, "Kofi", "kofi.m3x9", "no")).rejects.toThrow("QB_MANAGED_CONSENT_REQUIRED");
    await expect(provision(OTHER_TEACHER, CHILD2, "Kofi", "kofi.m3x9")).rejects.toThrow("QB_CLASS_NOT_MANAGED");
    await expect(provision(TEACHER, CHILD2, "K", "kofi.m3x9")).rejects.toThrow("QB_MANAGED_NAME_INVALID");
    await expect(provision(TEACHER, CHILD2, "Kofi<script>", "kofi.m3x9")).rejects.toThrow("QB_MANAGED_NAME_INVALID");
    await expect(provision(TEACHER, CHILD2, "Kofi", "Kofi@x.com")).rejects.toThrow("QB_MANAGED_USERNAME_INVALID");
    await expect(provision(TEACHER, id(999), "Kofi", "kofi.m3x9")).rejects.toThrow("AUTH_REQUIRED");                     // no sign-in exists for that id
    expect((await q("select count(*)::int n from public.student_profiles")).n).toBe(1);                                     // nothing half-created
  });

  it("lists a class's managed learners to its teacher only, and ties reset and archive to that teacher", async () => {
    await provision(TEACHER, CHILD2, "Kofi", "kofi.m3x9");
    await as(TEACHER);
    const list = await rpc("select public.qb_managed_learner_list($1)", [CLASS]);
    expect(list.map((l: any) => [l.first_name, l.username, l.status])).toEqual([["Ama", "ama.k7f2", "active"], ["Kofi", "kofi.m3x9", "active"]]);
    await as(OTHER_TEACHER); await expect(q("select public.qb_managed_learner_list($1)", [CLASS])).rejects.toThrow("QB_CLASS_NOT_MANAGED");
    expect(await rpc("select public.qb_managed_learner_authorise($1,$2)", [TEACHER, CHILD1])).toBe(true);
    expect(await rpc("select public.qb_managed_learner_authorise($1,$2)", [OTHER_TEACHER, CHILD1])).toBe(false);
    expect(await rpc("select public.qb_managed_learner_authorise($1,$2)", [TEACHER, WARD])).toBe(false);                    // an ordinary learner is never "managed"
    await expect(q("select public.qb_managed_learner_archive($1)", [CHILD1])).rejects.toThrow("QB_MANAGED_LEARNER_NOT_FOUND");   // the other teacher cannot archive
  });

  it("archives a learner: account inactive, out of the class, history kept", async () => {
    await as(TEACHER);
    expect(await rpc("select public.qb_managed_learner_archive($1)", [CHILD2])).toEqual({ archived: true });
    expect(await q("select p.status as pstatus, sp.status as sstatus, sp.archived_at is not null as archived, m.status as mstatus from public.profiles p join public.student_profiles sp on sp.user_id = p.id join public.class_memberships m on m.student_user_id = p.id where p.id = $1", [CHILD2]))
      .toEqual({ pstatus: "inactive", sstatus: "inactive", archived: true, mstatus: "inactive" });
    const list = await rpc("select public.qb_managed_learner_list($1)", [CLASS]);
    expect(list.find((l: any) => l.first_name === "Kofi")).toMatchObject({ status: "inactive" });
  });

  it("blocks public features for managed minors, and leaves ordinary learners and other features alone", async () => {
    await as(CHILD1);
    for (const f of ["chat", "public_leaderboards", "sponsored_prizes", "paid_challenges", "public_discoverability"]) expect(await rpc("select public.qb_feature_allowed($1)", [f])).toBe(false);
    expect(await rpc("select public.qb_feature_allowed('practice')")).toBe(true);
    await as(WARD);                                                                                                         // an ordinary adult-registered learner with no restriction
    expect(await rpc("select public.qb_feature_allowed('chat')")).toBe(true);
    await db.exec(`insert into public.learner_consent(user_id,status) values ('${WARD}','pending')`);
    await as(WARD);
    expect(await rpc("select public.qb_feature_allowed('chat')")).toBe(false);                                              // the original consent rule still applies
  });

  it("keeps the server-only functions away from browsers, and gives the route a durable limit", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select public.qb_managed_learner_provision($1,$2,$3,'Ama','ama.zz11','consent ok')", [TEACHER, CLASS, CHILD1])).rejects.toThrow();
      await expect(db.query("select public.qb_consume_budget('x', 5, 3600)")).rejects.toThrow();
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    const hits = []; for (let i = 0; i < 4; i++) hits.push(await rpc("select public.qb_consume_budget('managed:t:h', 3, 3600)"));
    await db.exec("reset role");
    expect(hits).toEqual([true, true, true, false]);
  });

  it("rolls back to the original feature rule", async () => {
    await db.exec(ROLLBACK);
    await as(CHILD1);
    expect(await rpc("select public.qb_feature_allowed('chat')")).toBe(true);                                               // the managed-minor block is gone; consent is still 'granted'
    expect((await q("select to_regprocedure('public.qb_managed_learner_provision(uuid,uuid,uuid,text,text,text)') f")).f).toBeNull();
  });
});
