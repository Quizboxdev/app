import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Help centre corrections from the 20 November 2026 guide audit (migration 20261120130000). Runs the real seed and refresh migrations on a stand-in help_articles table,
// then the correction. Checks each corrected sentence changed, a second run changes nothing, a guide an administrator edited is left alone, the rollback puts the old text back,
// and no published guide is left pointing at a guide that is still hidden.
const DIR = "supabase/migrations";
const CHAIN = ["20261040100000_help_seed_v1", "20261042100000_help_seats_guide", "20261044100000_help_marketplace_guides", "20261086100000_help_guides_refresh", "20261117100000_parent_family_help"];
const FIX = `${DIR}/20261120130000_help_guides_corrections.sql`;
const ROLLBACK = "supabase/rollback/help_guides_corrections.sql";
const ADMIN = "00000000-0000-0000-0000-0000000000a1";

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
    insert into public.profiles(id) values ('${ADMIN}');
  `);
  for (const f of CHAIN) await db.exec(readFileSync(`${DIR}/${f}.sql`, "utf8"));
  return db;
}
const bodies = async (db: PGlite) => Object.fromEntries((await db.query<{ slug: string; body: string }>("select slug, body from public.help_articles")).rows.map((r) => [r.slug, r.body]));

describe("help guide corrections (20261120130000)", () => {
  it("fixes the dead links, the under-13 class-code line and what a link to an existing child allows", async () => {
    const db = await setup();
    const before = await bodies(db);
    await db.exec(readFileSync(FIX, "utf8"));
    const after = await bodies(db);
    expect(before["getting-started-learner"]).toContain("(help:set-up-your-school)");
    expect(after["getting-started-learner"]).not.toContain("help:set-up-your-school");
    for (const dead of ["help:set-up-your-school", "help:family-workspace-start", "help:sell-question-sets"]) expect(after["getting-started-teacher"]).not.toContain(dead);
    expect(after["create-a-class"]).toContain("Learners under 13 can join with a class code");
    expect(after["find-your-way-around"]).toContain("workspace selector");
    expect(after["parents-and-family-workspace"]).toContain("Sponsor / organization");
    expect(after["parents-and-family-workspace"]).not.toContain("give them work. QuizBox");
    expect(after["parents-and-family-workspace"]).not.toContain("no chat and no public leaderboards");
    expect(after["link-an-existing-student"]).not.toContain("cannot be linked this way");
    expect(after["child-workspace-link"]).toContain("They cannot give you work");
    expect(after["add-a-child"]).not.toContain("public leaderboards");
    await db.close();
  });

  it("every corrected sentence was found (no silent misses) and a second run changes nothing", async () => {
    const db = await setup();
    const sql = readFileSync(FIX, "utf8");
    const olds = [...sql.matchAll(/\('([a-z0-9-]+)', \$a\$([\s\S]*?)\$a\$, \$b\$/g)].map((m) => ({ slug: m[1], old: m[2] }));
    expect(olds.length).toBeGreaterThanOrEqual(15);
    const before = await bodies(db);
    for (const o of olds) expect(before[o.slug], `${o.slug} no longer contains: ${o.old.slice(0, 60)}`).toContain(o.old);
    await db.exec(sql);
    const once = await bodies(db);
    await db.exec(sql);
    expect(await bodies(db)).toEqual(once);
    await db.close();
  });

  it("leaves a guide an administrator edited exactly as it is", async () => {
    const db = await setup();
    await db.exec(`update public.help_articles set updated_by = '${ADMIN}' where slug in ('getting-started-teacher', 'create-a-class')`);
    const before = await bodies(db);
    await db.exec(readFileSync(FIX, "utf8"));
    const after = await bodies(db);
    expect(after["getting-started-teacher"]).toBe(before["getting-started-teacher"]);
    expect(after["create-a-class"]).toBe(before["create-a-class"]);
    expect(after["getting-started-learner"]).not.toBe(before["getting-started-learner"]);
    await db.close();
  });

  it("the rollback puts every guide back as it was", async () => {
    const db = await setup();
    const before = await bodies(db);
    await db.exec(readFileSync(FIX, "utf8"));
    await db.exec(readFileSync(ROLLBACK, "utf8"));
    expect(await bodies(db)).toEqual(before);
    await db.close();
  });

  it("no published guide links to a guide that is still hidden", async () => {
    const db = await setup();
    await db.exec(readFileSync(FIX, "utf8"));
    const rows = (await db.query<{ slug: string; body: string; state: string }>("select slug, body, state from public.help_articles")).rows;
    const state = new Map(rows.map((r) => [r.slug, r.state]));
    const broken: string[] = [];
    for (const r of rows.filter((x) => x.state === "published")) for (const m of r.body.matchAll(/\(help:([a-z0-9-]+)\)/g)) if (state.get(m[1]) !== "published") broken.push(`${r.slug} -> ${m[1]}`);
    expect(broken).toEqual([]);
    await db.close();
  });
});
