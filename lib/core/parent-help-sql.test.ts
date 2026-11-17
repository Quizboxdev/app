import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Parent help guide (migration 20261117100000): runs the real migration on a stand-in help_articles table. Checks that the guide is published to everyone,
// that a second run changes nothing, that the rollback removes it, and that the links it uses point at pages that exist.
const MIG = "supabase/migrations/20261117100000_parent_family_help.sql";
const ROLLBACK = "supabase/rollback/parent_family_help.sql";
const SLUG = "parents-and-family-workspace";

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
  `);
  await db.exec(readFileSync(MIG, "utf8"));
  return db;
}

describe("parent help guide", () => {
  it("publishes the guide to sponsors (parents sign up as sponsors), in the account category", async () => {
    const db = await setup();
    const row = (await db.query<{ state: string; audiences: string[]; category: string; published_at: string | null }>(
      `select state, audiences, category, published_at::text from public.help_articles where slug = '${SLUG}'`)).rows[0];
    expect(row).toMatchObject({ state: "published", audiences: ["sponsor"], category: "account" });
    expect(row.published_at).not.toBeNull();
  });

  it("can be run again without adding a second copy or changing an edited guide", async () => {
    const db = await setup();
    await db.exec(`update public.help_articles set title = 'Edited in Admin' where slug = '${SLUG}'`);
    await db.exec(readFileSync(MIG, "utf8"));
    const rows = (await db.query<{ n: number; title: string }>(`select count(*)::int as n, max(title) as title from public.help_articles where slug = '${SLUG}'`)).rows[0];
    expect(rows).toEqual({ n: 1, title: "Edited in Admin" });
  });

  it("the rollback removes the guide only while nobody has edited it", async () => {
    const db = await setup();
    await db.exec(readFileSync(ROLLBACK, "utf8"));
    expect((await db.query(`select 1 from public.help_articles where slug = '${SLUG}'`)).rows).toHaveLength(0);

    const edited = await setup();
    await edited.exec(`insert into public.profiles(id) values ('00000000-0000-0000-0000-0000000000a1'); update public.help_articles set updated_by = '00000000-0000-0000-0000-0000000000a1' where slug = '${SLUG}'`);
    await edited.exec(readFileSync(ROLLBACK, "utf8"));
    expect((await edited.query(`select 1 from public.help_articles where slug = '${SLUG}'`)).rows).toHaveLength(1);
  });

  it("links only to pages that exist", () => {
    const body = readFileSync(MIG, "utf8");
    const links = [...body.matchAll(/\]\((\/[^)]+)\)/g)].map((m) => m[1]);
    expect(links).toContain("/contact");
    for (const link of links) expect(readFileSync(`app/(public)${link}/page.tsx`, "utf8").length, link).toBeGreaterThan(0);
  });
});
