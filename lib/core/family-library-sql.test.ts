import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Family workspace phase 5 (migration 20261084100000): a parent gives a Marketplace set they bought to chosen children, without copying anything. Runs the real migration SQL.
const MIGS = ["20261079100000_family_workspace", "20261084100000_family_library"].map((m) => `supabase/migrations/${m}.sql`);
const A = "00000000-0000-0000-0000-0000000000a1", B = "00000000-0000-0000-0000-0000000000a2", SELLER = "00000000-0000-0000-0000-0000000000a3";
const AMA = "00000000-0000-0000-0000-0000000000c1", KOJO = "00000000-0000-0000-0000-0000000000c2", SENA = "00000000-0000-0000-0000-0000000000c3";
const MKT = "00000000-0000-0000-0000-0000000000d1", ITEM = "00000000-0000-0000-0000-0000000000e1", ITEM2 = "00000000-0000-0000-0000-0000000000e2";

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.platform_settings (key text, value jsonb, description text, scope_type text not null default 'global');
    create schema quizbox_core;
    create function quizbox_core.flag(p_key text, p_scope_type text default 'global', p_scope uuid default null) returns boolean language sql as $$ select coalesce((select value = 'true'::jsonb from public.platform_settings where key = p_key limit 1), false) $$;
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb, created_at timestamptz default now());
    create function quizbox_core.audit(p_action text, p_entity_type text, p_entity uuid, p_details jsonb default '{}') returns void language sql as $$ insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (auth.uid(), p_action, p_entity_type, p_entity, 'pass', p_details) $$;
    create table public.profiles (id uuid primary key, full_name text, email text, role text, status text default 'active');
    create table public.student_profiles (id uuid primary key default gen_random_uuid(), user_id uuid unique, grade_code text, school_name text);
    create table public.notifications (id uuid primary key default gen_random_uuid(), recipient_user_id uuid, recipient_role text, type text, title text, message text, entity_type text, entity_id uuid);
    create table public.mk_items (id uuid primary key, title text, subject text, school_name text, grade text, term text, slug text, status text default 'approved');
    create table public.mk_questions (id uuid primary key default gen_random_uuid(), item_id uuid, position integer, question_text text, options jsonb, correct_index integer, explanation text);
    create table public.mk_purchases (id uuid primary key default gen_random_uuid(), item_id uuid, buyer_user_id uuid, item_title text, item_subject text, item_school text, item_grade text, status text default 'active', purchased_at timestamptz default now(), expires_at timestamptz not null default now() + interval '90 days');
    create table public.mk_attempts (id uuid primary key default gen_random_uuid(), item_id uuid, user_id uuid, correct integer, total integer, created_at timestamptz default now());
    create table public.account_relationships (
      id uuid primary key default gen_random_uuid(),
      source_user_id uuid not null references public.profiles(id), target_user_id uuid not null references public.profiles(id),
      relationship_type text not null check (relationship_type in ('guardian','sponsor','institutional')),
      status text not null default 'requested' check (status in ('requested','pending_verification','active','suspended','revoked')),
      can_fund boolean not null default false, can_view_progress boolean not null default false, can_manage_account boolean not null default false,
      consent_status text not null default 'pending' check (consent_status in ('not_required','pending','granted','withdrawn')),
      verified_by uuid, verified_at timestamptz, valid_from timestamptz not null default now(), valid_until timestamptz,
      created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      check (source_user_id <> target_user_id), check (valid_until is null or valid_until > valid_from), check (status <> 'active' or verified_by is not null)
    );
    insert into public.profiles(id, full_name, email, role) values ('${A}', 'John Mensah', 'j@x.test', 'teacher'), ('${B}', 'Efua Boateng', 'e@x.test', 'sponsor'), ('${SELLER}', 'Seller', 's@x.test', 'teacher'),
      ('${AMA}', 'Ama Mensah', 'a@x.test', 'student'), ('${KOJO}', 'Kojo Mensah', 'k@x.test', 'student'), ('${SENA}', 'Sena Boateng', 'se@x.test', 'student');
    insert into public.mk_items values ('${ITEM}', 'Fractions drill', 'Maths', 'XYZ', 'B5', 'Term 1', 'fractions', 'approved'), ('${ITEM2}', 'Science quiz', 'Science', 'XYZ', 'B5', null, 'sci', 'approved');
    insert into public.mk_questions(item_id, position, question_text, options, correct_index, explanation) values ('${ITEM}', 1, '1/2 + 1/2?', '["1","2","1/4"]', 0, 'It is one whole.'), ('${ITEM}', 2, '3/4 of 8?', '["6","4","2"]', 0, null);
  `);
  for (const m of MIGS) await db.exec(readFileSync(m, "utf8"));
  await db.exec(`update public.platform_settings set value = 'true'::jsonb where key = 'flags.family_workspace'`);
  const attach = (p: string, s: string, t = "parent") => db.exec(`select public.qb_family_attach_child('${p}', '${s}', '${t}')`);
  await db.exec(`insert into public.student_profiles(user_id, grade_code) values ('${AMA}', 'B5'), ('${KOJO}', 'B5'), ('${SENA}', 'B5')`);
  await attach(A, AMA); await attach(A, KOJO); await attach(B, SENA, "mentor");
  await db.exec(`insert into public.mk_purchases(item_id, buyer_user_id, item_title, item_subject, item_school, item_grade) values ('${ITEM}', '${A}', 'Fractions drill', 'Maths', 'XYZ', 'B5')`);
  return db;
}
const as = (db: PGlite, uid: string | null) => db.exec(`select set_config('test.uid', '${uid ?? ""}', false)`);
const one = async (db: PGlite, sql: string) => (await db.query<{ r: any }>(sql)).rows[0].r;
const grant = (db: PGlite, item: string, kids: string[]) => one(db, `select public.qb_family_grant_set('${item}', array[${kids.map((k) => `'${k}'::uuid`).join(",")}]) as r`);

describe("giving a purchased set to children", () => {
  it("gives the set to the ticked children only, tells them, and copies nothing", async () => {
    const db = await setup(); await as(db, A);
    expect(await grant(db, ITEM, [AMA])).toEqual({ granted: 1 });
    expect((await db.query("select 1 from public.mk_questions")).rows).toHaveLength(2);
    expect((await db.query("select 1 from public.mk_purchases")).rows).toHaveLength(1);
    expect((await db.query<any>("select recipient_user_id, type from public.notifications")).rows).toEqual([{ recipient_user_id: AMA, type: "family_set" }]);
    await as(db, AMA); expect((await one(db, "select public.qb_family_my_sets() as r")).map((s: any) => [s.title, s.from])).toEqual([["Fractions drill", "John Mensah"]]);
    await as(db, KOJO); expect(await one(db, "select public.qb_family_my_sets() as r")).toEqual([]);
  });
  it("giving again does not notify twice or create a second grant, and several children can be ticked at once", async () => {
    const db = await setup(); await as(db, A);
    await grant(db, ITEM, [AMA]); expect(await grant(db, ITEM, [AMA, KOJO])).toEqual({ granted: 1 });
    expect((await db.query("select 1 from public.family_set_grants")).rows).toHaveLength(2);
    expect((await db.query("select 1 from public.notifications")).rows).toHaveLength(2);
  });
  it("refuses a set the parent has not bought, a child who is not theirs, one they may not give work to, and an empty list", async () => {
    const db = await setup(); await as(db, A);
    await expect(grant(db, ITEM2, [AMA])).rejects.toThrow(/QB_NOT_PURCHASED/);
    await expect(grant(db, ITEM, [SENA])).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
    await expect(db.query(`select public.qb_family_grant_set('${ITEM}', array[]::uuid[])`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
    await db.exec(`insert into public.mk_purchases(item_id, buyer_user_id, item_title, item_subject, item_school, item_grade) values ('${ITEM}', '${B}', 'Fractions drill', 'Maths', 'XYZ', 'B5')`);
    await as(db, B); await expect(grant(db, ITEM, [SENA])).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
    expect((await db.query("select 1 from public.family_set_grants")).rows).toHaveLength(0);
  });
  it("an expired or reversed purchase cannot be given, and takes the child's access away", async () => {
    const db = await setup(); await as(db, A); await grant(db, ITEM, [AMA]);
    await db.exec("update public.mk_purchases set status = 'reversed'");
    await as(db, AMA);
    expect(await one(db, "select public.qb_family_my_sets() as r")).toEqual([]);
    await expect(db.query(`select public.qb_family_set_open('${ITEM}')`)).rejects.toThrow(/QB_NOT_PURCHASED/);
    await as(db, A); await expect(grant(db, ITEM, [KOJO])).rejects.toThrow(/QB_NOT_PURCHASED/);
    await db.exec("update public.mk_purchases set status = 'active', expires_at = now() - interval '1 day'");
    await as(db, AMA); await expect(db.query(`select public.qb_family_set_open('${ITEM}')`)).rejects.toThrow(/QB_NOT_PURCHASED/);
  });
});

describe("the child's side", () => {
  it("opens the original set and records a score; a child who was not given it cannot", async () => {
    const db = await setup(); await as(db, A); await grant(db, ITEM, [AMA]);
    await as(db, AMA);
    const open = await one(db, `select public.qb_family_set_open('${ITEM}') as r`);
    expect(open.title).toBe("Fractions drill"); expect(open.questions).toHaveLength(2); expect(open.questions[0].correct_index).toBe(0);
    await db.exec(`select public.qb_family_set_record('${ITEM}', 2, 2)`);
    expect((await db.query<any>("select user_id, correct, total from public.mk_attempts")).rows).toEqual([{ user_id: AMA, correct: 2, total: 2 }]);
    await expect(db.query(`select public.qb_family_set_record('${ITEM}', 3, 2)`)).rejects.toThrow(/QB_INVALID_ATTEMPT/);
    await as(db, KOJO);
    await expect(db.query(`select public.qb_family_set_open('${ITEM}')`)).rejects.toThrow(/QB_NOT_PURCHASED/);
    await expect(db.query(`select public.qb_family_set_record('${ITEM}', 1, 2)`)).rejects.toThrow(/QB_NOT_PURCHASED/);
    await as(db, null); await expect(db.query(`select public.qb_family_set_open('${ITEM}')`)).rejects.toThrow(/QB_AUTH_REQUIRED/);
  });
  it("the parent sees which children have the set and their best score, and can take it back", async () => {
    const db = await setup(); await as(db, A); await grant(db, ITEM, [AMA, KOJO]);
    await as(db, AMA); await db.exec(`select public.qb_family_set_record('${ITEM}', 1, 2), public.qb_family_set_record('${ITEM}', 2, 2)`);
    await as(db, A);
    const lib = await one(db, "select public.qb_family_library() as r");
    expect(lib).toHaveLength(1); expect(lib[0].active).toBe(true);
    expect(lib[0].children.map((c: any) => [c.name, c.best === null ? null : Number(c.best)])).toEqual([["Ama Mensah", 100], ["Kojo Mensah", null]]);
    await db.exec(`select public.qb_family_revoke_grant('${ITEM}', '${KOJO}')`);
    expect((await one(db, "select public.qb_family_library() as r"))[0].children.map((c: any) => c.name)).toEqual(["Ama Mensah"]);
    await as(db, KOJO); await expect(db.query(`select public.qb_family_set_open('${ITEM}')`)).rejects.toThrow(/QB_NOT_PURCHASED/);
    await as(db, B); await expect(db.query(`select public.qb_family_revoke_grant('${ITEM}', '${AMA}')`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
  });
  it("another family's library shows nothing of this one, and a revoked child drops out of the parent's view", async () => {
    const db = await setup(); await as(db, A); await grant(db, ITEM, [AMA, KOJO]);
    await db.exec(`select public.qb_family_revoke('${KOJO}')`);
    expect((await one(db, "select public.qb_family_library() as r"))[0].children.map((c: any) => c.name)).toEqual(["Ama Mensah"]);
    await as(db, B); expect(await one(db, "select public.qb_family_library() as r")).toEqual([]);
  });
  it("is for signed-in users only", async () => {
    const db = await setup();
    const can = async (fn: string, role: string) => (await one(db, `select has_function_privilege('${role}', '${fn}', 'execute') as r`)) as boolean;
    for (const f of ["qb_family_library()", "qb_family_grant_set(uuid, uuid[])", "qb_family_revoke_grant(uuid, uuid)", "qb_family_my_sets()", "qb_family_set_open(uuid)", "qb_family_set_record(uuid, integer, integer)"]) { expect(await can(`public.${f}`, "authenticated")).toBe(true); expect(await can(`public.${f}`, "anon")).toBe(false); }
  });
});
