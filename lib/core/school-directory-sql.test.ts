import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The school directory (migration 20261074100000) on a small stand-in schema: filters, the add-a-school queue, the staff decisions and the CSV import. Runs the real migration SQL.
const MIG = "supabase/migrations/20261074100000_school_directory.sql";
const ADMIN = "00000000-0000-0000-0000-0000000000a1", ANA = "00000000-0000-0000-0000-0000000000b1", KOFI = "00000000-0000-0000-0000-0000000000b2", TEACHER = "00000000-0000-0000-0000-0000000000c1";

async function setup(flag = true) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create schema quizbox_market; create function quizbox_market.is_super() returns boolean language sql as $$ select coalesce(current_setting('test.super', true), '') = 'on' $$;
    create table public.platform_settings (key text, value jsonb, description text, scope_type text not null default 'global');
    create schema quizbox_core; create function quizbox_core.flag(p_key text, p_scope_type text default 'global', p_scope uuid default null) returns boolean language sql as $$ select coalesce((select (value)::text = 'true' from public.platform_settings where key = p_key), false) $$;
    create table public.profiles (id uuid primary key, full_name text, email text, school_name text);
    create table public.institutions (id uuid primary key default gen_random_uuid(), name text);
    create table public.student_profiles (user_id uuid primary key, school_name text, updated_at timestamptz);
    create table public.teacher_profiles (user_id uuid primary key, school_name text, updated_at timestamptz);
    insert into public.profiles values ('${ADMIN}', 'Admin', 'admin@x.test', null), ('${ANA}', 'Ana', 'ana@x.test', null), ('${KOFI}', 'Kofi', 'kofi@x.test', null), ('${TEACHER}', 'Teacher', 't@x.test', null);
    insert into public.student_profiles values ('${ANA}', 'st marys jhs', now()), ('${KOFI}', null, now());
    insert into public.teacher_profiles values ('${TEACHER}', null, now());
  `);
  await db.exec(readFileSync(MIG, "utf8"));
  if (flag) await db.exec(`update public.platform_settings set value = 'true'::jsonb where key = 'flags.school_directory'`);
  return db;
}
const as = (db: PGlite, uid: string | null, sup = false) => db.exec(`select set_config('test.uid', '${uid ?? ""}', false), set_config('test.super', '${sup ? "on" : ""}', false)`);
const one = async (db: PGlite, sql: string) => (await db.query<{ r: any }>(sql)).rows[0].r;
const rows = [
  { name: "ST. MARY'S Junior High", ownership: "Private", region: "Ashanti", district: "Kumasi Metropolitan", levels: "Primary|JHS" },
  { name: "Prempeh College", ownership: "public", region: "Ashanti", district: "Kumasi Metro", levels: "SHS", school_code: "0050108" },
  { name: "Kumasi Academy", ownership: "Public", region: "Ashanti", district: "Asokore Mampong", levels: "SHS" },
  { name: "Tema Grace Basic", ownership: "Private", region: "Greater Accra", district: "Tema Metropolitan", levels: "Primary|JHS" },
];
const load = async (db: PGlite) => { await as(db, ADMIN, true); return one(db, `select public.qb_school_admin_import('${JSON.stringify(rows).replace(/'/g, "''")}'::jsonb, 'test') as r`); };

describe("school directory: switched off", () => {
  it("answers nothing and refuses writes while the flag is off", async () => {
    const db = await setup(false);
    await as(db, ANA);
    expect(await one(db, `select public.qb_school_regions() as r`)).toEqual([]);
    await expect(db.query(`select public.qb_school_submit('Ashanti', 'Kumasi Metropolitan', 'Some School', 'private', array['jhs'])`)).rejects.toThrow(/QB_FEATURE_DISABLED/);
    await expect(db.query(`select public.qb_school_set_mine(gen_random_uuid())`)).rejects.toThrow(/QB_FEATURE_DISABLED/);
  });
  it("is closed to people who are not signed in and to browsers reading the table", async () => {
    const db = await setup();
    await as(db, null);
    await expect(db.query(`select public.qb_school_regions()`)).rejects.toThrow(/QB_AUTHENTICATION_REQUIRED/);
    expect((await db.query<{ r: boolean }>(`select has_table_privilege('authenticated', 'public.school_directory', 'select') as r`)).rows[0].r).toBe(false);
  });
});

describe("school directory: the pickers and the Public / Private filter", () => {
  it("imports, merges look-alike rows and counts what it skipped", async () => {
    const db = await setup();
    const first = await load(db);
    expect(first).toMatchObject({ added: 4, updated: 0, skipped: 0 });
    const again = await one(db, `select public.qb_school_admin_import('[{"name":"prempeh college","region":"Ashanti","district":"Kumasi Metropolitan","levels":"SHS","town":"Sofoline","gender":"boys"},{"name":"X","region":"Atlantis","district":"D","levels":"SHS"},{"name":"No Level School","region":"Volta","district":"Ho","levels":""}]'::jsonb) as r`);
    expect(again).toMatchObject({ added: 0, updated: 1, skipped: 2 });
    expect(again.problems).toHaveLength(2);
    const p = await one(db, `select to_jsonb(d) as r from public.school_directory d where name_key = 'prempeh college' or name_key = 'prempehcollege'`);
    expect(p).toMatchObject({ town: "Sofoline", gender: "boys", school_code: "0050108", ownership: "public", status: "approved" });
    expect(await one(db, `select count(*)::int as r from public.school_directory`)).toBe(4);
    await expect(db.query(`select public.qb_school_admin_import((select jsonb_agg(jsonb_build_object('name', 'School ' || g, 'region', 'Volta', 'district', 'Ho', 'levels', 'JHS')) from generate_series(1, 501) g))`)).rejects.toThrow(/QB_TOO_MANY_ROWS/);
  });
  it("narrows by region, district, ownership, level and typed text", async () => {
    const db = await setup(); await load(db); await as(db, ANA);
    expect(await one(db, `select public.qb_school_regions() as r`)).toEqual([{ region: "Ashanti", schools: 3 }, { region: "Greater Accra", schools: 1 }]);
    expect(await one(db, `select public.qb_school_regions('GH', 'private') as r`)).toEqual([{ region: "Ashanti", schools: 1 }, { region: "Greater Accra", schools: 1 }]);
    expect(await one(db, `select public.qb_school_districts('Ashanti', 'GH', 'public', 'shs') as r`)).toEqual([{ district: "Asokore Mampong", schools: 1 }, { district: "Kumasi Metro", schools: 1 }]);
    const pub = await one(db, `select public.qb_school_search('Ashanti', 'Kumasi Metro', 'public') as r`);
    expect(pub.map((s: any) => s.name)).toEqual(["Prempeh College"]);
    const typed = await one(db, `select public.qb_school_search('Ashanti', null, null, null, 'kumasi') as r`);
    expect(typed.map((s: any) => s.name)).toEqual(["Kumasi Academy"]);
    expect(await one(db, `select public.qb_school_search('Ashanti', null, null, null, '%') as r`)).toEqual([]);
    expect(await one(db, `select public.qb_school_search('Ashanti', 'Kumasi Metropolitan', 'private', 'jhs') as r`)).toHaveLength(1);
    await expect(db.query(`select public.qb_school_search('Ashanti')`)).rejects.toThrow(/QB_SCHOOL_DISTRICT_REQUIRED/);
  });
});

describe("school directory: adding a missing school", () => {
  it("queues a new school, returns an existing look-alike, hides it from others and limits how many wait", async () => {
    const db = await setup(); await load(db); await as(db, ANA);
    const dup = await one(db, `select public.qb_school_submit('Ashanti', 'Kumasi Metropolitan', 'prempeh  COLLEGE', 'public', array['shs']) as r`);
    expect(dup).toMatchObject({ existing: true, name: "Prempeh College" });
    const made = await one(db, `select public.qb_school_submit('Ashanti', 'Kumasi Metropolitan', 'Bright Future Academy', 'private', array['primary','jhs'], 'Ahodwo') as r`);
    expect(made).toMatchObject({ existing: false, status: "pending" });
    expect(await one(db, `select public.qb_school_submit('Ashanti', 'Kumasi Metropolitan', 'bright future  academy', null, array['jhs']) as r`)).toMatchObject({ existing: true, status: "pending" });
    const mine = await one(db, `select public.qb_school_search('Ashanti', 'Kumasi Metropolitan', 'private') as r`);
    expect(mine.map((s: any) => [s.name, s.pending])).toEqual([["Bright Future Academy", true], ["ST. MARY'S Junior High", false]]);
    await as(db, KOFI);
    expect((await one(db, `select public.qb_school_search('Ashanti', 'Kumasi Metropolitan', 'private') as r`)).map((s: any) => s.name)).toEqual(["ST. MARY'S Junior High"]);
    await as(db, ANA);
    for (const n of ["Alpha", "Bravo", "Charlie", "Delta"]) await db.query(`select public.qb_school_submit('Volta', 'Ho Municipal', '${n} Basic School', 'private', array['primary'])`);
    await expect(db.query(`select public.qb_school_submit('Volta', 'Ho Municipal', 'Echo Basic School', 'private', array['primary'])`)).rejects.toThrow(/QB_RATE_LIMITED/);
    for (const bad of [`'http://spam.example'`, `'<b>x</b> School'`, `'ab'`]) await expect(db.query(`select public.qb_school_submit('Volta', 'Ho', ${bad}, null, array['jhs'])`)).rejects.toThrow(/QB_SCHOOL_INVALID/);
    await expect(db.query(`select public.qb_school_submit('Atlantis', 'Ho', 'Real Looking School', null, array['jhs'])`)).rejects.toThrow(/QB_SCHOOL_INVALID/);
    await expect(db.query(`select public.qb_school_submit('Volta', 'Ho', 'Real Looking School', null, array[]::text[])`)).rejects.toThrow(/QB_SCHOOL_LEVEL_REQUIRED/);
  });
  it("flags a district the directory does not know yet for staff", async () => {
    const db = await setup(); await load(db); await as(db, ANA);
    await db.query(`select public.qb_school_submit('Ashanti', 'Brand New District', 'Hilltop Academy', 'private', array['jhs'])`);
    expect(await one(db, `select needs_review as r from public.school_directory where name = 'Hilltop Academy'`)).toBe(true);
  });
});

describe("school directory: the staff queue", () => {
  it("is for super admins only", async () => {
    const db = await setup(); await load(db); await as(db, ANA);
    for (const sql of [`select public.qb_school_admin_list()`, `select public.qb_school_admin_decide(gen_random_uuid(), 'approve')`, `select public.qb_school_admin_update(gen_random_uuid(), '{}')`, `select public.qb_school_admin_import('[]')`])
      await expect(db.query(sql)).rejects.toThrow(/SUPER_ADMIN_REQUIRED/);
  });
  it("lists the waiting school with who added it and look-alikes, then approves it with a corrected name", async () => {
    const db = await setup(); await load(db); await as(db, ANA);
    const made = await one(db, `select public.qb_school_submit('Ashanti', 'Kumasi Metropolitan', 'Prempeh Coll', 'public', array['shs']) as r`);
    await db.query(`select public.qb_school_set_mine('${made.id}')`);
    await as(db, ADMIN, true);
    const list = await one(db, `select public.qb_school_admin_list('pending') as r`);
    expect(list.counts).toMatchObject({ pending: 1, approved: 4 });
    expect(list.rows[0]).toMatchObject({ name: "Prempeh Coll", submitter_name: "Ana", users_linked: 1 });
    expect(list.rows[0].similar.map((s: any) => s.name)).toContain("Prempeh College");
    await one(db, `select public.qb_school_admin_decide('${made.id}', 'approve', 'Checked with GES', null, '{"name":"Prempeh College Annex","town":"Kumasi"}') as r`);
    expect(await one(db, `select name || '/' || status as r from public.school_directory where id = '${made.id}'`)).toBe("Prempeh College Annex/approved");
    expect(await one(db, `select school_name as r from public.student_profiles where user_id = '${ANA}'`)).toBe("Prempeh College Annex");
    await expect(db.query(`select public.qb_school_admin_decide('${made.id}', 'approve')`)).rejects.toThrow(/QB_INVALID_TRANSITION/);
  });
  it("refuses an approval that would duplicate a school, and merges instead", async () => {
    const db = await setup(); await load(db); await as(db, ANA);
    const made = await one(db, `select public.qb_school_submit('Ashanti', 'Kumasi Metropolitan', 'Prempeh Coll', 'public', array['shs']) as r`);
    await db.query(`select public.qb_school_set_mine('${made.id}')`);
    await as(db, ADMIN, true);
    await expect(db.query(`select public.qb_school_admin_decide('${made.id}', 'approve', null, null, '{"name":"Prempeh College"}')`)).rejects.toThrow(/QB_SCHOOL_DUPLICATE/);
    const target = await one(db, `select id::text as r from public.school_directory where name = 'Prempeh College'`);
    const res = await one(db, `select public.qb_school_admin_decide('${made.id}', 'merge', 'Same school', '${target}') as r`);
    expect(res).toMatchObject({ decision: "merge", people_updated: 1 });
    expect(await one(db, `select school_directory_id::text = '${target}' as r from public.student_profiles where user_id = '${ANA}'`)).toBe(true);
    expect(await one(db, `select school_name as r from public.profiles where id = '${ANA}'`)).toBe("Prempeh College");
    expect(await one(db, `select status as r from public.school_directory where id = '${made.id}'`)).toBe("merged");
    await expect(db.query(`select public.qb_school_admin_decide('${made.id}', 'merge', 'again', '${target}')`)).rejects.toThrow(/QB_INVALID_TRANSITION/);
  });
  it("rejects with a reason and frees the people who used the school to pick again", async () => {
    const db = await setup(); await load(db); await as(db, ANA);
    const made = await one(db, `select public.qb_school_submit('Volta', 'Ho Municipal', 'Doubtful School', 'private', array['jhs']) as r`);
    await db.query(`select public.qb_school_set_mine('${made.id}')`);
    await as(db, ADMIN, true);
    await expect(db.query(`select public.qb_school_admin_decide('${made.id}', 'reject', '')`)).rejects.toThrow(/QB_REASON_REQUIRED/);
    expect(await one(db, `select public.qb_school_admin_decide('${made.id}', 'reject', 'Not a registered school') as r`)).toMatchObject({ people_updated: 1 });
    expect(await one(db, `select school_directory_id is null as r from public.student_profiles where user_id = '${ANA}'`)).toBe(true);
    await as(db, ANA);
    expect(await one(db, `select public.qb_school_search('Volta', 'Ho Municipal') as r`)).toEqual([]);
  });
  it("corrects an approved school and everyone linked sees the new name", async () => {
    const db = await setup(); await load(db); await as(db, TEACHER);
    const id = await one(db, `select id::text as r from public.school_directory where name = 'Kumasi Academy'`);
    await db.query(`select public.qb_school_set_mine('${id}')`);
    await as(db, ADMIN, true);
    await db.query(`select public.qb_school_admin_update('${id}', '{"name":"Kumasi Academy Senior High","town":"Asokore Mampong"}')`);
    expect(await one(db, `select school_name as r from public.teacher_profiles where user_id = '${TEACHER}'`)).toBe("Kumasi Academy Senior High");
    expect(await one(db, `select school_name as r from public.profiles where id = '${TEACHER}'`)).toBe("Kumasi Academy Senior High");
  });
});

describe("school directory: a person's own school", () => {
  it("links once, accepts the same school again and refuses a different one", async () => {
    const db = await setup(); await load(db); await as(db, KOFI);
    const [a, b] = [await one(db, `select id::text as r from public.school_directory where name = 'Kumasi Academy'`), await one(db, `select id::text as r from public.school_directory where name = 'Prempeh College'`)];
    expect(await one(db, `select public.qb_school_set_mine('${a}') as r`)).toMatchObject({ name: "Kumasi Academy", pending: false });
    expect(await one(db, `select public.qb_school_set_mine('${a}') as r`)).toMatchObject({ name: "Kumasi Academy" });
    await expect(db.query(`select public.qb_school_set_mine('${b}')`)).rejects.toThrow(/QB_SCHOOL_ALREADY_SET/);
    await expect(db.query(`select public.qb_school_set_mine(gen_random_uuid())`)).rejects.toThrow(/QB_NOT_FOUND/);
    expect(await one(db, `select school_name as r from public.student_profiles where user_id = '${KOFI}'`)).toBe("Kumasi Academy");
  });
  it("lets a person use only their own waiting school", async () => {
    const db = await setup(); await load(db); await as(db, ANA);
    const made = await one(db, `select public.qb_school_submit('Volta', 'Ho Municipal', 'Ana Private Academy', 'private', array['jhs']) as r`);
    await as(db, KOFI);
    await expect(db.query(`select public.qb_school_set_mine('${made.id}')`)).rejects.toThrow(/QB_NOT_FOUND/);
  });
});
