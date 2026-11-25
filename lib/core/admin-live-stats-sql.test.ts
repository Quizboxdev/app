import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TILES } from "../admin/live";

// The admin live figures (migration 20261125100000). The tables the counts read are built from the real migrations (foreign keys removed), so a wrong table or column name shows up here as a null count.
const MIG = "supabase/migrations/20261125100000_admin_live_stats.sql";
const STAFF = "00000000-0000-0000-0000-0000000000a1", USER = "00000000-0000-0000-0000-0000000000b1";
const dir = "supabase/migrations";
const sources = readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "20261125").sort().map((f) => readFileSync(`${dir}/${f}`, "utf8").replace(/--[^\n]*/g, ""));

// The body of "create table x ( ... )", found by matching brackets (quotes are skipped so a bracket inside a pattern does not count).
function tableBody(name: string): string {
  const [schema, table] = name.split(".");
  const re = new RegExp(`create table (?:if not exists )?${schema === "public" ? "(?:public\\.)?" : `${schema}\\.`}${table}\\s*\\(`, "i");
  for (const sql of sources) {
    const m = re.exec(sql);
    if (!m) continue;
    let depth = 1, i = m.index + m[0].length, quoted = false;
    for (; i < sql.length && depth > 0; i++) { const c = sql[i]; if (c === "'") quoted = !quoted; else if (!quoted && c === "(") depth++; else if (!quoted && c === ")") depth--; }
    return sql.slice(m.index + m[0].length, i - 1);
  }
  throw new Error(`no create table for ${name}`);
}
// Columns only: the first word and the type of each definition. Constraints, defaults and references are not needed to prove a query names real columns.
function columnsOf(name: string): string[] {
  const body = tableBody(name), parts: string[] = [];
  let depth = 0, start = 0, quoted = false;
  for (let i = 0; i <= body.length; i++) {
    const c = body[i];
    if (c === "'") quoted = !quoted;
    else if (!quoted && c === "(") depth++;
    else if (!quoted && c === ")") depth--;
    if (i === body.length || (c === "," && depth === 0 && !quoted)) { parts.push(body.slice(start, i).trim()); start = i + 1; }
  }
  const [schema, table] = name.split(".");
  const added = sources.flatMap((sql) => [...sql.matchAll(new RegExp(`alter table (?:if exists )?(?:only )?${schema === "public" ? "(?:public\\.)?" : `${schema}\\.`}${table}\\b([^;]*);`, "gi"))]
    .flatMap((m) => [...m[1].matchAll(/add column (?:if not exists )?(\w+)\s+([\w.\[\]]+)/gi)].map((c) => `${c[1]} ${c[2]}`)));
  const cols = new Map<string, string>();
  for (const p of [...parts, ...added]) {
    const m = /^(\w+)\s+([\w.\[\]]+(?:\([\d, ]+\))?)/.exec(p);
    if (!m || /^(constraint|primary|unique|check|foreign|exclude)$/i.test(m[1])) continue;
    const type = /^(uuid|text|integer|bigint|smallint|numeric|boolean|jsonb|json|date|timestamptz|timestamp|bytea|interval)(\b|\(|\[)/i.test(`${m[2]} `) ? m[2] : "text";
    if (!cols.has(m[1])) cols.set(m[1], type);
  }
  return [...cols].map(([k, t]) => `${k} ${t}`);
}

const REAL = ["public.markets", "public.school_directory", "public.partners", "public.market_attribution_issues", "quizbox_sources.ingestion_jobs", "public.question_load_batches", "public.question_batch_approvals",
  "public.curriculum_topics", "quizbox_factory.campaigns", "quizbox_factory.jobs", "public.mk_items", "public.mk_sellers", "public.challenge_campaigns", "public.challenge_reports", "public.challenge_awards",
  "quizbox_competition.candidates", "quizbox_competition.generation_jobs", "public.sme_profiles", "public.sme_review_assignments", "quizbox_competition.review_events", "public.sme_payout_batches", "public.mk_payouts",
  "public.payment_intents", "public.refund_cases", "public.affiliates", "public.support_requests", "quizbox_private.public_interest_submissions", "public.student_profiles", "public.sponsor_family_applications",
  "public.learner_subscriptions", "public.user_capabilities", "public.help_articles", "public.help_videos", "public.marketing_posts", "public.policy_versions", "public.social_channels"];
// Tables that predate the migration folder (the same shapes the other database tests use).
const BASELINE = `
  create table public.profiles (id uuid primary key default gen_random_uuid(), role text, created_at timestamptz default now());
  create table public.questions (id uuid primary key default gen_random_uuid(), grade text, canonical_grade_code text, source_grade_code text, subject_name text, status text, validation_status text);
  create table public.attempts (id uuid primary key default gen_random_uuid(), started_at timestamptz default now(), submitted_at timestamptz);
  create table public.sponsor_profiles (id uuid primary key default gen_random_uuid(), user_id uuid, sponsor_type text, verification_status text);
  create table public.content_reports (id uuid primary key default gen_random_uuid(), status text default 'open');
  create table public.system_events (id uuid primary key default gen_random_uuid(), event_type text, severity text, details jsonb, created_at timestamptz default now());
  create table public.notification_deliveries (id uuid primary key default gen_random_uuid(), status text);`;

async function setup(skip: string[] = []) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create schema quizbox_core; create schema quizbox_market; create schema quizbox_sme; create schema quizbox_sources; create schema quizbox_factory; create schema quizbox_competition; create schema quizbox_private;
    create function quizbox_core.is_staff() returns boolean language sql as $$ select coalesce(current_setting('test.staff', true), '') = 'on' $$;
    create function quizbox_sme.has_capability(p_cap text) returns boolean language sql as $$ select position(p_cap in coalesce(current_setting('test.caps', true), '')) > 0 or position('super_admin' in coalesce(current_setting('test.caps', true), '')) > 0 $$;
    create function quizbox_market.is_super() returns boolean language sql as $$ select quizbox_sme.has_capability('super_admin') $$;
    create function public.qb_managed_retention_months() returns integer language sql as $$ select 12 $$;
    ${BASELINE}`);
  for (const t of REAL.filter((t) => !skip.includes(t))) await db.exec(`create table ${t} (${columnsOf(t).join(", ")})`);
  await db.exec(`
    insert into public.profiles(role, created_at) values ('student', now()), ('teacher', now() - interval '10 days');
    insert into public.questions(grade, status, validation_status) values ('B4','active','approved'), ('B4','active','approved'), ('B4','inactive','review'), ('B7','active','approved'), ('B7','archived','review');
    insert into public.attempts(started_at, submitted_at) values (now(), now()), (now(), null);
    insert into public.markets(status) values ('ACTIVE'), ('CONFIGURING');
    insert into public.support_requests(status, created_at) values ('open', now()), ('open', now() - interval '20 days'), ('resolved', now());`);
  await db.exec(`insert into public.refund_cases(status) values ('open'); insert into public.system_events(event_type, severity, details, created_at) values ('CLIENT_ERROR', 'error', '{"count": 3}', now());`);
  await db.exec(readFileSync(MIG, "utf8"));
  return db;
}
const as = (db: PGlite, uid: string | null, caps = "", staff = true) => db.exec(`select set_config('test.uid', '${uid ?? ""}', false), set_config('test.staff', '${staff ? "on" : ""}', false), set_config('test.caps', '${caps}', false)`);
const live = async (db: PGlite, section: string, days = 30, maxAge: number | null = null) => (await db.query<{ r: any }>(`select public.qb_admin_live('${section}', ${days}, ${maxAge}) as r`)).rows[0].r;
const age = (db: PGlite, seconds: number) => db.exec(`update quizbox_stats.snapshots set computed_at = now() - interval '${seconds} seconds'`);

describe("admin live figures", () => {
  it("are for staff only, and refuse an unknown section", async () => {
    const db = await setup();
    await as(db, USER, "", false);
    await expect(live(db, "queues")).rejects.toThrow(/QB_FORBIDDEN/);
    await as(db, null);
    await expect(live(db, "queues")).rejects.toThrow(/QB_FORBIDDEN/);
    await as(db, STAFF, "super_admin");
    await expect(live(db, "everything")).rejects.toThrow(/QB_INVALID_ACTION/);
  });

  it("counts every tile against the real table shapes", async () => {
    const db = await setup(); await as(db, STAFF, "super_admin");
    const q = await live(db, "queues");
    const missing = Object.entries(q.data).filter(([, v]) => v === null).map(([k]) => k);
    expect(missing).toEqual([]);
    expect(q.data).toMatchObject({ markets_active: 1, markets_setting_up: 1, support_open: 2, support_new_7d: 2, refunds_open: 1, client_errors_24h: 3, server_errors_24h: 0 });
    expect(Object.keys(q.data).sort()).toEqual(TILES.map((t) => t.key).sort());
    expect(q.stale).toBe(false);
  });

  it("reports content and people", async () => {
    const db = await setup(); await as(db, STAFF, "super_admin");
    const c = await live(db, "content");
    expect(c.data.content).toMatchObject({ live: 3, in_review: 1, batches_waiting: 0 });
    expect(c.data.content.by_class).toMatchObject([{ grade: "B4", live: 2, in_review: 1 }, { grade: "B7", live: 1, in_review: 0 }]);
    const p = await live(db, "people", 7);
    expect(p.data.users).toMatchObject({ total: 2, new_7d: 1, new_prev_7d: 1 });
    expect(p.data.users.signups).toHaveLength(7);
    expect(p.data.learning).toMatchObject({ attempts_total: 2 });
    expect(p.data.markets).toEqual({ ACTIVE: 1, CONFIGURING: 1 });
  });

  it("shows each SHS year, which has no national grade, and the subjects inside every class", async () => {
    const db = await setup(); await as(db, STAFF, "super_admin");
    await db.exec(`delete from public.questions;
      insert into public.questions(grade, canonical_grade_code, source_grade_code, subject_name, status, validation_status) values
        (null, 'SHS1', 'SHS 1', 'Biology', 'active', 'approved'), (null, 'SHS1', 'SHS 1', 'BIOLOGY', 'active', 'approved'), (null, null, 'SHS 1', 'Chemistry', 'inactive', 'review'),
        ('B10', 'SHS1', 'B10', 'Chemistry', 'active', 'approved'), (null, 'SHS3', 'SHS 3', 'Physics', 'active', 'approved'), (null, null, null, null, 'active', 'approved'),
        ('B5', null, null, 'Science', 'active', 'approved'), ('B6', 'B6', 'B6', 'Science', 'archived', 'review')`);
    const { content } = (await live(db, "content")).data;
    expect(content).toMatchObject({ live: 6, in_review: 1 });
    const by = Object.fromEntries(content.by_class.map((r: any) => [r.grade, r]));
    expect(Object.keys(by).sort()).toEqual(["B5", "Not set", "SHS1", "SHS3"]); // a class with nothing live or in review is left out
    expect(by.SHS1).toMatchObject({ live: 3, in_review: 1 });
    expect(by.SHS1.subjects.map((s: any) => [s.subject.toLowerCase(), s.live, s.in_review]).sort()).toEqual([["biology", 2, 0], ["chemistry", 1, 1]]);
    expect(by.SHS3.subjects).toEqual([{ subject: "Physics", live: 1, in_review: 0 }]);
  });

  it("only returns the counts a person's permissions allow, from the same snapshot", async () => {
    const db = await setup(); await as(db, STAFF, "super_admin");
    await live(db, "queues");
    await as(db, STAFF, "");
    const plain = (await live(db, "queues")).data;
    expect(plain.support_open).toBe(2);
    for (const k of ["refunds_open", "schools_waiting", "enquiries_new", "topics_draft"]) expect(plain).not.toHaveProperty(k);
    await as(db, STAFF, "finance_admin");
    const finance = (await live(db, "queues")).data;
    expect(finance.refunds_open).toBe(1);
    expect(finance).not.toHaveProperty("schools_waiting");
  });

  it("serves the stored snapshot until it is old, then calculates again", async () => {
    const db = await setup(); await as(db, STAFF, "super_admin");
    await live(db, "queues");
    await db.exec("insert into public.support_requests(status) values ('open')");
    expect((await live(db, "queues")).data.support_open).toBe(2);
    expect((await live(db, "queues", 30, 0)).data.support_open).toBe(2); // a refresh button cannot force more often than every 5 seconds
    await age(db, 6);
    expect((await live(db, "queues", 30, 0)).data.support_open).toBe(3);
    await db.exec("insert into public.support_requests(status) values ('open')");
    await age(db, 25);
    expect((await live(db, "queues")).data.support_open).toBe(4);
  });

  it("keeps the last good figures, marked stale, when a refresh fails", async () => {
    const db = await setup(); await as(db, STAFF, "super_admin");
    await live(db, "queues"); await age(db, 600);
    await db.exec("create or replace function quizbox_stats.compute_queues() returns jsonb language plpgsql set search_path = '' as $$ begin raise exception 'broken'; end $$");
    const r = await live(db, "queues");
    expect(r.stale).toBe(true);
    expect(r.data.support_open).toBe(2);
    expect(r.age_seconds).toBeGreaterThanOrEqual(599);
  });

  it("gives null for a table that is missing, and still answers the rest", async () => {
    const db = await setup();
    await db.exec("drop table public.social_channels"); await as(db, STAFF, "super_admin");
    const q = (await live(db, "queues")).data;
    expect(q.social_channels).toBeNull();
    expect(q.support_open).toBe(2);
  });

  it("can be applied twice, and the rollback removes it", async () => {
    const db = await setup();
    await db.exec(readFileSync(MIG, "utf8"));
    await db.exec("select quizbox_stats.refresh_all()");
    expect((await db.query("select section from quizbox_stats.snapshots order by 1")).rows).toHaveLength(3);
    await db.exec(readFileSync("supabase/rollback/admin_live_stats.sql", "utf8"));
    await expect(db.query("select public.qb_admin_live('queues')")).rejects.toThrow(/does not exist/);
  });
});
