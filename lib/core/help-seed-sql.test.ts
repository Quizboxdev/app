import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The first Help centre guides: complete, safe, linked to each other, and true to the menus (isolated PostgreSQL; both migrations applied unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261039100000_help_centre.sql");
const SEED = read("../../supabase/migrations/20261040100000_help_seed_v1.sql");
const SEATS_GUIDE = read("../../supabase/migrations/20261042100000_help_seats_guide.sql");
const APPSHELL = read("../../components/AppShell.tsx");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, SUPPORT, STUDENT] = [1, 2, 3].map(id);
let db: PGlite;
const as = async (user: string | "service" | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user && user !== "service" ? user : ""]);
  await db.exec(user === "service" ? "set role service_role" : user ? "set role authenticated" : "set role anon");
};
const q = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0];
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await q(sql, params)) ?? {})[0] as any;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, details jsonb);
    create function public.qb_support_is_staff() returns boolean language sql stable security definer as $$ select exists(select 1 from public.profiles where id = auth.uid() and role in ('OWNER','SUPPORT')) $$;
    create schema quizbox_core;
    create function quizbox_core.audit(p_action text, p_entity_type text, p_entity uuid, p_details jsonb default '{}') returns void language sql security definer as $$
      insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, details) values (auth.uid(), p_action, p_entity_type, p_entity, p_details) $$;
    grant usage on schema quizbox_core to authenticated; grant execute on function quizbox_core.audit(text, text, uuid, jsonb) to authenticated;
    insert into public.profiles values ('${OWNER}','OWNER','active'),('${SUPPORT}','SUPPORT','active'),('${STUDENT}','STUDENT','active');
  `);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

beforeAll(async () => { await db.exec(SEED); await db.exec(SEATS_GUIDE); });

const all = async () => { await db.exec("reset role"); return (await db.query<{ slug: string; title: string; summary: string; body: string; audiences: string[]; category: string; state: string }>("select slug, title, summary, body, audiences, category, state from public.help_articles order by sort_order, slug")).rows; };

describe("the first Help centre guides", () => {
  it("are all published, for learners, teachers, schools and sponsors, and none for administrators", async () => {
    const rows = await all();
    expect(rows.length).toBeGreaterThanOrEqual(23);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(rows.length);
    expect(rows.filter((r) => r.slug !== "add-more-players").every((r) => r.state === "published")).toBe(true);
    expect(rows.find((r) => r.slug === "add-more-players")).toMatchObject({ state: "draft", category: "challenges" });          // the seats guide waits until the owner switches seat limits on
    for (const r of rows) expect(r.audiences.every((a) => ["everyone", "student", "teacher", "school", "sponsor"].includes(a)), r.slug).toBe(true);
    for (const who of ["student", "teacher", "school", "sponsor"]) expect(rows.filter((r) => r.audiences.includes(who) || r.audiences.includes("everyone")).length, who).toBeGreaterThanOrEqual(8);
    expect(rows.some((r) => /(admin|administrator|super admin|content factory|payouts|question loading)/i.test(r.title + " " + r.summary)), "no admin workflow").toBe(false);
  });

  it("cover the guides the owner asked for: practice, challenge, competition, assignment, class, class code, young learners, payments, refunds, support", async () => {
    const slugs = (await all()).map((r) => r.slug);
    for (const s of ["practice-session", "create-a-challenge", "create-a-competition", "create-an-assignment", "create-a-class", "join-a-class", "add-young-learners", "subscribe-and-coins", "ask-for-a-refund", "contact-support", "reset-password", "share-challenge-or-competition", "unfinished-work"]) expect(slugs, s).toContain(s);
  });

  it("every guide links only to guides that exist or to pages that exist, and holds no placeholder or HTML", async () => {
    const rows = await all(), slugs = new Set(rows.map((r) => r.slug)), pages = new Set(["/contact", "/privacy", "/terms", "/refunds", "/cookies"]);
    let links = 0;
    for (const r of rows) {
      for (const m of r.body.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
        const href = m[1]; links += 1;
        if (href.startsWith("help:")) expect(slugs.has(href.slice(5)), `${r.slug} links to missing guide ${href}`).toBe(true);
        else expect(pages.has(href), `${r.slug} links to ${href}`).toBe(true);
      }
      expect(r.body, r.slug).not.toMatch(/\{\{|<\/?[a-z]+[ >]/i);
      expect(r.body.startsWith(`# ${r.title}`), `${r.slug} starts with its title`).toBe(true);
      expect(r.body.length, r.slug).toBeGreaterThan(400);
      expect(r.summary.length, r.slug).toBeGreaterThanOrEqual(10); expect(r.summary.length, r.slug).toBeLessThanOrEqual(240);
    }
    expect(links, "the link check really found links").toBeGreaterThan(30);
  });

  it("name only menu items that exist in the app", async () => {
    const labels = ["Practise", "Assignments", "Compete", "Challenges", "My challenges", "Create and share", "Progress", "Notifications", "Unfinished work", "Account", "Subscribe", "Classes", "Young learners", "Gradebook", "Question Banks", "Practise questions", "Open to join", "Overview", "Teachers", "Learners", "Performance", "Home"];
    for (const l of labels) expect(APPSHELL.includes(`"${l}"`), `menu item ${l}`).toBe(true);
  });

  it("can be found by the words people use", async () => {
    await as(null);
    const find = async (words: string, audience: string | null = null) => (await rpc("select public.qb_help_search($1,$2)", [words, audience])).map((x: any) => x.slug);
    expect(await find("class code")).toEqual(expect.arrayContaining(["join-a-class", "create-a-class"]));
    expect(await find("refund")).toContain("ask-for-a-refund");
    expect(await find("password")).toContain("reset-password");
    expect(await find("forgot password")).toContain("reset-password");
    expect(await find("share link whatsapp")).toContain("share-challenge-or-competition");
    expect(await find("rounds")).toContain("create-a-competition");
    expect(await find("assignment", "student")).toContain("do-an-assignment");
    expect(await find("assignment", "student")).not.toContain("create-an-assignment");           // a learner is not shown the teacher's steps first
    expect(await find("assignment", "teacher")).toContain("create-an-assignment");
    expect(await find("paystack")).toContain("subscribe-and-coins");
    expect(await find("support")).toContain("contact-support");
  });

  it("do not overwrite an edit when the seed is applied again", async () => {
    await as(OWNER);
    const g = (await rpc("select public.qb_help_admin_list()")).find((r: any) => r.slug === "reset-password");
    const full = await rpc("select public.qb_help_admin_get($1)", [g.id]);
    await rpc("select public.qb_help_save($1,$2,$3,$4,$5,$6,$7,$8)", [g.id, full.slug, "Reset your password (edited)", full.summary, full.body, full.category, full.audiences, full.sort_order]);
    await db.exec("reset role"); await db.exec(SEED);
    expect((await all()).find((r) => r.slug === "reset-password")!.title).toBe("Reset your password (edited)");
  });
});
