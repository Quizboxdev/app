import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261019120000_reviewer_applications.sql");
const ROLLBACK = read("../../supabase/rollback/reviewer_applications.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
const as = (n: number, caps = "") => db.exec(`select set_config('request.jwt.claim.sub','${id(n)}',false), set_config('test.caps','${caps}',false)`);
const one = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0] ?? {};
const apply = (over: Record<string, unknown> = {}) => one("select public.qb_apply_reviewer($1::jsonb) v", [JSON.stringify({ qualifications: "BEd Mathematics, 8 years teaching JHS and SHS", years_experience: 8, subjects: ["Mathematics", "Science"], education_levels: ["JHS"], ...over })]);
const decide = (user: number, decision: string, note: string, domains: unknown[] = []) => one("select public.qb_reviewer_application_decide($1,$2,$3,$4::jsonb) v", [id(user), decision, note, JSON.stringify(domains)]);
const MATHS = { subject_code: "Mathematics", education_level: "JHS", grade_codes: ["B7", "B8"] };

// users: 1 teacher (applies), 2 teacher (declined later), 3 student, 4 support staff (sme_support), 5 owner (super_admin), 6 ordinary teacher
describe("reviewer applications (isolated PostgreSQL)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create schema auth; create schema quizbox_sme;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function quizbox_sme.has_capability(p text) returns boolean language sql stable as $$ select position(p in coalesce(current_setting('test.caps',true),'')) > 0 $$;
      create table public.markets(id uuid primary key, country_id uuid);
      create table public.profiles(id uuid primary key, role text, status text default 'active', full_name text, email text, school_name text, primary_market_id uuid, default_market_id uuid);
      create table public.sme_profiles(user_id uuid primary key references public.profiles(id), reviewer_status text not null default 'pending' check (reviewer_status in ('pending','verified','suspended')),
        country_id uuid, reviewer_tier text not null, qualification_summary text not null default '', years_experience integer not null default 0, payment_status text not null default 'pending',
        active boolean not null default false, requested_domains jsonb not null default '[]', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
      create table public.sme_domain_assignments(id uuid primary key default gen_random_uuid(), reviewer_id uuid references public.sme_profiles(user_id), subject_code text, market_id uuid, education_level text,
        grade_codes text[] default '{}', can_review boolean default false, can_approve boolean default false, can_senior_review boolean default false, active boolean default true);
      create table public.notifications(id uuid primary key default gen_random_uuid(), recipient_user_id uuid, recipient_email text, recipient_role text, type text, title text, message text, entity_type text, entity_id uuid);
      insert into public.markets values('${id(900)}','${id(901)}');
      insert into public.profiles(id, role, full_name, email, school_name, primary_market_id) values
        ('${id(1)}','TEACHER','Ama Owusu','ama@example.com','St Mary''s','${id(900)}'),('${id(2)}','TEACHER','Kofi Boateng','kofi@example.com','Zion JHS','${id(900)}'),
        ('${id(3)}','STUDENT','Student','s@example.com',null,'${id(900)}'),('${id(4)}','TEACHER','Support','support@example.com',null,'${id(900)}'),
        ('${id(5)}','ADMIN','Owner','owner@example.com',null,'${id(900)}'),('${id(6)}','TEACHER','Yaw','yaw@example.com','x','${id(900)}');
    `);
    await db.exec(MIGRATION);
  }, 60_000);
  afterAll(async () => { await db.close(); });

  it("lets a teacher apply, stores what was asked for, and refuses students and bad input", async () => {
    await as(3); await expect(apply()).rejects.toThrow("QB_TEACHER_REQUIRED");
    await as(1);
    await expect(apply({ qualifications: "short" })).rejects.toThrow("QB_APPLICATION_INVALID");
    await expect(apply({ subjects: [] })).rejects.toThrow("QB_APPLICATION_INVALID");
    await expect(apply({ years_experience: 99 })).rejects.toThrow("QB_APPLICATION_INVALID");
    expect((await apply()).v).toMatchObject({ status: "pending" });
    expect(await one("select reviewer_status, active, reviewer_tier, years_experience from public.sme_profiles where user_id = $1", [id(1)])).toEqual({ reviewer_status: "pending", active: false, reviewer_tier: "applicant", years_experience: 8 });
    expect((await one("select jsonb_array_length(requested_domains) n from public.sme_profiles where user_id = $1", [id(1)])).n).toBe(2);
    expect((await one("select public.qb_my_reviewer_application() v")).v).toMatchObject({ status: "pending", years_experience: 8 });
    expect((await apply({ years_experience: 9 })).v.status).toBe("pending");                                            // a pending application can be updated, not duplicated
    expect((await one("select count(*)::int n from public.sme_profiles")).n).toBe(1);
  });

  it("shows the queue to support staff and the owner only", async () => {
    await as(6); await expect(one("select public.qb_reviewer_applications('pending') v")).rejects.toThrow("SUPPORT_ACCESS_REQUIRED");
    await as(4, "sme_support");
    const q = (await one("select public.qb_reviewer_applications('pending') v")).v;
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ name: "Ama Owusu", email: "ama@example.com", school: "St Mary's", status: "pending", domains: 0 });
    await expect(one("select public.qb_reviewer_applications('everything') v")).rejects.toThrow("QB_INVALID_ACTION");
  });

  it("approves with chosen subjects: reviewer verified and active, domains granted, teacher notified", async () => {
    await as(6); await expect(decide(1, "approve", "ok", [MATHS])).rejects.toThrow("SUPPORT_ACCESS_REQUIRED");
    await as(4, "sme_support");
    await expect(decide(1, "approve", "Checked OK", [])).rejects.toThrow("QB_DOMAINS_REQUIRED");
    await expect(decide(1, "approve", "Checked OK", [{ ...MATHS, can_approve: true }])).rejects.toThrow("QB_SENIOR_GRANT_REQUIRES_OWNER");   // support staff cannot grant approval rights
    await expect(decide(1, "approve", "", [MATHS])).rejects.toThrow("QB_APPROVAL_NOTE_REQUIRED");
    expect((await decide(1, "approve", "Verified qualifications by phone", [MATHS, { subject_code: "Science", education_level: "JHS", grade_codes: ["B7"] }])).v).toEqual({ decision: "approve", domains_granted: 2 });
    expect(await one("select reviewer_status, active, reviewer_tier, decided_by from public.sme_profiles where user_id = $1", [id(1)])).toEqual({ reviewer_status: "verified", active: true, reviewer_tier: "reviewer", decided_by: id(4) });
    expect(await one("select count(*)::int n, bool_and(can_review) r, bool_or(can_approve) a from public.sme_domain_assignments where reviewer_id = $1", [id(1)])).toEqual({ n: 2, r: true, a: false });
    expect(await one("select title, type from public.notifications where recipient_user_id = $1", [id(1)])).toEqual({ title: "You are now a QuizBox reviewer", type: "REVIEWER_APPLICATION" });
    await expect(decide(1, "approve", "again please", [MATHS])).rejects.toThrow("QB_APPLICATION_NOT_PENDING");
    await as(1); await expect(apply()).rejects.toThrow("QB_ALREADY_REVIEWER");
    expect((await one("select public.qb_my_reviewer_application() v")).v.status).toBe("approved");
  });

  it("lets only the owner grant approval or senior rights", async () => {
    await as(6); await apply({ subjects: ["Mathematics"] });
    await as(5, "super_admin");
    expect((await decide(6, "approve", "Senior examiner with references", [{ ...MATHS, can_approve: true, can_senior_review: true }])).v.domains_granted).toBe(1);
    expect(await one("select can_approve, can_senior_review from public.sme_domain_assignments where reviewer_id = $1", [id(6)])).toEqual({ can_approve: true, can_senior_review: true });
  });

  it("declines with a reason, blocks a quick re-application, and allows one after 90 days", async () => {
    await as(2); await apply({ subjects: ["English"] });
    await as(4, "sme_support");
    await expect(decide(2, "decline", "too short", [])).rejects.toThrow("QB_APPROVAL_NOTE_REQUIRED");                       // a decline needs a real reason (10 characters)
    expect((await decide(2, "decline", "Qualifications could not be verified")).v.decision).toBe("decline");
    await as(2);
    const mine = (await one("select public.qb_my_reviewer_application() v")).v;
    expect(mine).toMatchObject({ status: "declined", note: "Qualifications could not be verified" });
    await expect(apply()).rejects.toThrow("QB_APPLICATION_DECLINED_RECENTLY");
    await db.exec(`update public.sme_profiles set decided_at = now() - interval '91 days' where user_id = '${id(2)}'`);
    expect((await apply({ subjects: ["English"] })).v.status).toBe("pending");
    expect((await one("select decision_note, decided_at from public.sme_profiles where user_id = $1", [id(2)]))).toEqual({ decision_note: null, decided_at: null });
  });

  it("keeps the functions away from signed-out users and rolls back", async () => {
    await db.exec("set role anon");
    await expect(one("select public.qb_my_reviewer_application() v")).rejects.toThrow();
    await db.exec("reset role");
    await db.exec(ROLLBACK);
    expect((await one("select to_regprocedure('public.qb_apply_reviewer(jsonb)') f")).f).toBeNull();
    expect((await one("select count(*)::int n from public.sme_profiles where reviewer_status = 'verified'")).n).toBe(2);   // granted reviewers stay
  });
});
