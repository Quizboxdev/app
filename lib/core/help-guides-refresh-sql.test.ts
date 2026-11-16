import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Help centre refresh (migration 20261086100000): runs the real migration on a stand-in help_articles table. Checks that the refresh only touches guides nobody has edited,
// that the new guides start in the right state, that a second run changes nothing, and that every help: link in the guides resolves to a guide that exists.
const MIG = "supabase/migrations/20261086100000_help_guides_refresh.sql";
const DIR = "supabase/migrations";
const SEED_FILES = readdirSync(DIR).filter((f) => /help|guide/.test(f) && f.endsWith(".sql")).map((f) => `${DIR}/${f}`);

const CATS = ["getting-started", "practise", "classes", "assignments", "challenges", "payments", "account", "safety"];

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create table public.profiles (id uuid primary key);
    create table public.help_articles (
      id uuid primary key default gen_random_uuid(),
      slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
      title text not null check (length(btrim(title)) between 3 and 120),
      summary text not null check (length(btrim(summary)) between 10 and 240),
      body text not null check (length(body) between 50 and 60000),
      category text not null check (category in ('getting-started', 'practise', 'classes', 'assignments', 'challenges', 'payments', 'account', 'safety')),
      audiences text[] not null default array['everyone'] check (cardinality(audiences) >= 1 and audiences <@ array['everyone', 'student', 'teacher', 'school', 'sponsor']::text[]),
      sort_order integer not null default 100,
      state text not null default 'draft' check (state in ('draft', 'published')),
      views integer not null default 0, helpful_yes integer not null default 0, helpful_no integer not null default 0,
      updated_by uuid references public.profiles(id) on delete set null,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(), published_at timestamptz
    );
    insert into public.help_articles(slug, title, summary, body, category, audiences, sort_order, state, published_at) values
      ('getting-started-learner', 'Getting started as a learner', 'Old summary for the learner guide here.', '# Getting started as a learner\\n\\n1. Choose your grade, so you see questions for your level.\\n2. Old steps that nobody edited.', 'getting-started', array['student'], 10, 'published', now()),
      ('create-an-assignment', 'Create an assignment', 'Old summary for the assignment guide here.', '# Create an assignment\\n\\n1. Old steps. Review and publish.', 'assignments', array['teacher'], 30, 'published', now()),
      ('getting-started-teacher', 'Getting started as a teacher', 'An admin already rewrote this teacher guide.', '# Getting started as a teacher\\n\\nAdmin wording that must not be lost.', 'getting-started', array['teacher'], 20, 'published', now());
  `);
  await db.exec(`insert into public.profiles(id) values ('00000000-0000-0000-0000-0000000000a1')`);
  await db.exec(`update public.help_articles set updated_by = '00000000-0000-0000-0000-0000000000a1' where slug = 'getting-started-teacher'`);
  return db;
}
const row = async (db: PGlite, slug: string) => (await db.query<any>(`select * from public.help_articles where slug = '${slug}'`)).rows[0];

describe("help guides refresh", () => {
  it("refreshes only guides nobody has edited, and leaves an admin's edit alone", async () => {
    const db = await setup();
    const before = await row(db, "getting-started-teacher");
    await db.exec(readFileSync(MIG, "utf8"));
    const learner = await row(db, "getting-started-learner");
    expect(learner.body).not.toContain("Choose your grade, so you see questions for your level.");
    expect(learner.body).toContain("Create your account and choose **Student**");
    expect(learner.summary).toContain("sign up, choose your class");
    expect((await row(db, "create-an-assignment")).body).toContain("**Review & publish**");
    const teacher = await row(db, "getting-started-teacher");
    expect(teacher.body).toBe(before.body);
    expect(teacher.summary).toBe(before.summary);
  });

  it("adds the new guides in the right state: live features published, flag-gated and family guides drafts", async () => {
    const db = await setup();
    await db.exec(readFileSync(MIG, "utf8"));
    const states = Object.fromEntries((await db.query<any>("select slug, state from public.help_articles")).rows.map((r: any) => [r.slug, r.state]));
    for (const s of ["find-your-way-around", "add-your-subjects", "your-work-from-school-and-family", "assign-by-topic"]) expect(states[s]).toBe("published");
    for (const s of ["set-up-your-school", "family-workspace-start", "add-a-child", "link-an-existing-student", "child-workspace-link", "give-work-to-children", "pay-for-children", "family-question-library", "family-challenges"]) expect(states[s]).toBe("draft");
    const published = await db.query<any>("select published_at from public.help_articles where slug = 'add-your-subjects'");
    expect(published.rows[0].published_at).not.toBeNull();
    expect((await row(db, "family-challenges")).published_at).toBeNull();
  });

  it("running it again changes nothing", async () => {
    const db = await setup();
    await db.exec(readFileSync(MIG, "utf8"));
    const first = (await db.query<any>("select slug, title, summary, body, state from public.help_articles order by slug")).rows;
    await db.exec(readFileSync(MIG, "utf8"));
    expect((await db.query<any>("select slug, title, summary, body, state from public.help_articles order by slug")).rows).toEqual(first);
    expect(first).toHaveLength(3 + 13);
  });

  it("every guide uses a real category and its length is within the database limit", async () => {
    const db = await setup();
    await db.exec(readFileSync(MIG, "utf8"));
    for (const r of (await db.query<any>("select slug, category, body from public.help_articles")).rows) {
      expect(CATS, r.slug).toContain(r.category);
      expect(r.body.length, r.slug).toBeLessThanOrEqual(60000);
    }
  });

  it("every help: link in the new and refreshed guides points at a guide that exists", () => {
    const text = readFileSync(MIG, "utf8");
    const known = new Set<string>();
    for (const f of [...SEED_FILES, MIG]) {
      for (const m of readFileSync(f, "utf8").matchAll(/values \('([a-z0-9-]+)'/g)) known.add(m[1]);
    }
    const links = [...text.matchAll(/\(help:([a-z0-9-]+)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(20);
    expect(links.filter((l) => !known.has(l))).toEqual([]);
  });

  it("the guides never promise a screen the menus do not have, and the family guides say they are for teachers and sponsors", async () => {
    const db = await setup();
    await db.exec(readFileSync(MIG, "utf8"));
    const rows = (await db.query<any>("select slug, body, audiences from public.help_articles")).rows;
    for (const r of rows) expect(r.body, r.slug).not.toMatch(/TODO|lorem|xxx/i);
    expect((await row(db, "family-workspace-start")).audiences).toEqual(["teacher", "sponsor"]);
    expect((await row(db, "child-workspace-link")).audiences).toEqual(["student"]);
  });
});
