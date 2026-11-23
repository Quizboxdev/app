import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Family guides (migration 20261123110000): runs the real migration and rollback on a stand-in help_articles table. The eight family drafts are published as one set,
// a guide an administrator has edited is left alone, a second run changes nothing, and the links between the guides lead to guides that will be published.
const MIG = "supabase/migrations/20261123110000_family_guides_published.sql";
const ROLLBACK = "supabase/rollback/family_guides_published.sql";
const FAMILY = ["family-workspace-start", "add-a-child", "link-an-existing-student", "child-workspace-link", "give-work-to-children", "pay-for-children", "family-question-library", "family-challenges"];

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create table public.profiles (id uuid primary key);
    create table public.help_articles (
      id uuid primary key default gen_random_uuid(), slug text not null unique, title text not null, body text not null default '', state text not null default 'draft' check (state in ('draft', 'published')),
      updated_by uuid references public.profiles(id) on delete set null, updated_at timestamptz not null default now(), published_at timestamptz
    );
    insert into public.help_articles(slug, title, state) select s, s, 'draft' from unnest(array[${FAMILY.map((s) => `'${s}'`).join(",")}, 'set-up-your-school']) s;
    update public.help_articles set body = E'Steps\n\n1. Buy a set in the [Marketplace](help:buy-a-question-set).\n2. Open the library.' where slug = 'family-question-library';
    insert into public.help_articles(slug, title, state, published_at) values ('create-a-class', 'Create a class', 'published', now());
  `);
  return db;
}
const states = async (db: PGlite) => Object.fromEntries((await db.query<{ slug: string; state: string }>(`select slug, state from public.help_articles`)).rows.map((r) => [r.slug, r.state]));

describe("family guides published as a set", () => {
  it("publishes the eight family drafts, sets the publish date, and touches no other guide", async () => {
    const db = await setup();
    await db.exec(readFileSync(MIG, "utf8"));
    const s = await states(db);
    for (const slug of FAMILY) expect(s[slug], slug).toBe("published");
    expect(s["set-up-your-school"]).toBe("draft");
    expect(s["create-a-class"]).toBe("published");
    expect((await db.query(`select 1 from public.help_articles where slug = any($1) and published_at is null`, [FAMILY])).rows).toHaveLength(0);
  });

  it("turns the one link to a draft Marketplace guide into plain text, only while the guide is unedited", async () => {
    const db = await setup();
    await db.exec(readFileSync(MIG, "utf8"));
    const body = (await db.query<{ body: string }>(`select body from public.help_articles where slug = 'family-question-library'`)).rows[0].body;
    expect(body).toContain("1. Buy a set in the **Marketplace**.");
    expect(body).not.toContain("help:buy-a-question-set");
    const kept = await setup();
    await kept.exec(`insert into public.profiles(id) values ('00000000-0000-0000-0000-0000000000a1'); update public.help_articles set updated_by = '00000000-0000-0000-0000-0000000000a1' where slug = 'family-question-library'`);
    await kept.exec(readFileSync(MIG, "utf8"));
    expect((await kept.query<{ body: string }>(`select body from public.help_articles where slug = 'family-question-library'`)).rows[0].body).toContain("help:buy-a-question-set");
  });

  it("leaves a guide an administrator has edited, and can be run again without changing the publish date", async () => {
    const db = await setup();
    await db.exec(`insert into public.profiles(id) values ('00000000-0000-0000-0000-0000000000a1'); update public.help_articles set updated_by = '00000000-0000-0000-0000-0000000000a1' where slug = 'pay-for-children'`);
    await db.exec(readFileSync(MIG, "utf8"));
    expect((await states(db))["pay-for-children"]).toBe("draft");
    const before = (await db.query<{ p: string }>(`select published_at::text as p from public.help_articles where slug = 'add-a-child'`)).rows[0].p;
    await db.exec(readFileSync(MIG, "utf8"));
    expect((await db.query<{ p: string }>(`select published_at::text as p from public.help_articles where slug = 'add-a-child'`)).rows[0].p).toBe(before);
  });

  it("the rollback puts the eight back to draft and deletes nothing", async () => {
    const db = await setup();
    await db.exec(readFileSync(MIG, "utf8"));
    await db.exec(readFileSync(ROLLBACK, "utf8"));
    const s = await states(db);
    for (const slug of FAMILY) expect(s[slug], slug).toBe("draft");
    expect(s["create-a-class"]).toBe("published");
  });

  it("every guide link inside the family guides leads to a guide that exists and is not a draft", () => {
    const text = readdirSync("supabase/migrations").filter((f) => /help/.test(f) || /family_help/.test(f)).map((f) => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
    const defined = new Set([...text.matchAll(/values \(\s*'([a-z0-9-]+)',/g)].map((m) => m[1]));
    const stillDraft = new Set(["set-up-your-school", "sell-question-sets", "buy-a-question-set"]);   // Marketplace and school-setup guides stay drafts for now
    for (const slug of FAMILY) {
      const at = text.indexOf(`values ('${slug}'`);
      expect(at, slug).toBeGreaterThan(-1);
      const body = text.slice(at, text.indexOf("$g$)", text.indexOf("$g$", at) + 3));
      for (const m of body.matchAll(/\(help:([a-z0-9-]+)\)/g)) {
        if (m[1] === "buy-a-question-set") { expect(readFileSync(MIG, "utf8"), "the migration must turn this link into text").toContain("help:buy-a-question-set"); continue; }   // still a draft: handled in the migration
        expect(defined.has(m[1]) && !stillDraft.has(m[1]), `${slug} links to ${m[1]}`).toBe(true);
      }
    }
  });
});
