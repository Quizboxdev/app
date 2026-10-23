import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The Help centre: reading, audiences, search, counters and staff management (isolated PostgreSQL; the migration is applied unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261039100000_help_centre.sql");
const ROLLBACK = read("../../supabase/rollback/help_centre.sql");
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
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
const BODY = (t: string) => `# ${t}\n\n1. Open the page.\n2. Press the button.\n\n` + "A sentence that keeps the guide long enough to be useful. ".repeat(3);
const save = (over: Record<string, unknown> = {}) => {
  const a = { id: null, slug: "share-a-challenge", title: "Share a challenge", summary: "How to send your challenge to friends and classmates.", body: BODY("Share a challenge"), category: "challenges", audiences: ["everyone"], sort: 100, ...over };
  return rpc("select public.qb_help_save($1,$2,$3,$4,$5,$6,$7,$8)", [a.id, a.slug, a.title, a.summary, a.body, a.category, a.audiences, a.sort]);
};
const state = (articleId: string, s: string) => rpc("select public.qb_help_set_state($1,$2)", [articleId, s]);

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

describe("help centre", () => {
  it("re-applies cleanly, and the table is closed to every browser", async () => {
    await db.exec(MIGRATION);
    await as(STUDENT); await fails("select * from public.help_articles", [], /permission denied/);
    await as(null); await fails("select * from public.help_articles", [], /permission denied/);
  });

  it("is managed by support staff only", async () => {
    await as(STUDENT);
    await fails("select public.qb_help_admin_list()", [], /QB_FORBIDDEN/);
    await fails("select public.qb_help_save(null,'x-guide','A title here','A summary long enough','body '||repeat('x',60),'account',array['everyone'],1)", [], /QB_FORBIDDEN/);
    await as(null); await fails("select public.qb_help_admin_list()", [], /permission denied/);
    await as(SUPPORT); expect(await rpc("select public.qb_help_admin_list()")).toEqual([]);
  });

  it("keeps a draft hidden from everyone until it is published, and hides it again when unpublished", async () => {
    await as(OWNER);
    const a = await save();
    expect(a).toMatchObject({ slug: "share-a-challenge", state: "draft", views: 0 });
    await as(null);
    expect(await rpc("select public.qb_help_list()")).toEqual([]);
    expect(await rpc("select public.qb_help_get('share-a-challenge')")).toBeNull();
    expect(await rpc("select public.qb_help_search('share')")).toEqual([]);
    await as(SUPPORT); expect(await state(a.id, "published")).toEqual({ ok: true, state: "published" });
    await as(null);
    expect((await rpc("select public.qb_help_list()")).map((x: any) => x.slug)).toEqual(["share-a-challenge"]);
    expect((await rpc("select public.qb_help_get('share-a-challenge')")).article).toMatchObject({ title: "Share a challenge", category: "challenges" });
    await as(OWNER); await state(a.id, "draft");
    await as(null); expect(await rpc("select public.qb_help_list()")).toEqual([]);
    await as(OWNER); await state(a.id, "published");
  });

  it("shows each role its own guides plus the ones for everyone; a visitor sees all", async () => {
    await as(OWNER);
    const t = await save({ slug: "create-a-class", title: "Create a class", summary: "How a teacher creates a class and sends its code.", category: "classes", audiences: ["teacher"] });
    const s = await save({ slug: "join-a-class", title: "Join a class with a code", summary: "How a learner joins a class using the code from the teacher.", category: "classes", audiences: ["student"] });
    await state(t.id, "published"); await state(s.id, "published");
    await as(STUDENT);
    expect((await rpc("select public.qb_help_list('student')")).map((x: any) => x.slug).sort()).toEqual(["join-a-class", "share-a-challenge"]);
    expect((await rpc("select public.qb_help_list('teacher')")).map((x: any) => x.slug).sort()).toEqual(["create-a-class", "share-a-challenge"]);
    expect((await rpc("select public.qb_help_list('admin')")).length).toBe(3);                                  // an unknown role sees everything, never an admin-only set
    await as(null); expect((await rpc("select public.qb_help_list()")).length).toBe(3);
  });

  it("refuses an administrator audience, a bad slug, a clash and a body that is too short", async () => {
    await as(OWNER);
    await fails("select public.qb_help_save(null,'admin-guide','Admin guide','A summary long enough here',$1,'account',array['admin'],1)", [BODY("x")], /QB_HELP_INVALID/);
    await fails("select public.qb_help_save(null,'Bad Slug!','A title here','A summary long enough here',$1,'account',array['everyone'],1)", [BODY("x")], /QB_HELP_INVALID/);
    await fails("select public.qb_help_save(null,'short-one','A title here','A summary long enough here','too short','account',array['everyone'],1)", [], /QB_HELP_INVALID/);
    await fails("select public.qb_help_save(null,'share-a-challenge','Another title','A summary long enough here',$1,'account',array['everyone'],1)", [BODY("x")], /QB_HELP_SLUG_TAKEN/);
  });

  it("searches words in the steps (stemmed), parts of a title, and ignores drafts and other audiences", async () => {
    await as(OWNER);
    const d = await save({ slug: "hidden-draft", title: "Draft about sharing", summary: "A draft guide nobody should see yet.", body: BODY("Draft about sharing") });
    const body = `# Competitions\n\nA competition has rounds. Players pass a round when they score the pass mark, so the best players reach the final.\n\n` + "More words so the guide is long enough. ".repeat(3);
    const c = await save({ slug: "create-a-competition", title: "Create a competition", summary: "Set up rounds and decide who goes through.", body, category: "challenges", audiences: ["teacher", "sponsor"] });
    await state(c.id, "published");
    await as(null);
    expect((await rpc("select public.qb_help_search('sharing')")).map((x: any) => x.slug)).toContain("share-a-challenge");     // "sharing" finds "share"
    expect((await rpc("select public.qb_help_search('pass mark')")).map((x: any) => x.slug)).toEqual(["create-a-competition"]);   // a phrase inside the steps
    expect((await rpc("select public.qb_help_search('compe')")).map((x: any) => x.slug)).toEqual(["create-a-competition"]);       // half a word of a title
    expect((await rpc("select public.qb_help_search('draft')")).map((x: any) => x.slug)).not.toContain(d.slug);                  // drafts never appear
    expect((await rpc("select public.qb_help_search('competition','student')")).map((x: any) => x.slug)).not.toContain("create-a-competition");
    expect((await rpc("select public.qb_help_search('competition','sponsor')")).map((x: any) => x.slug)).toContain("create-a-competition");
    expect(await rpc("select public.qb_help_search('a')")).toEqual([]);                                                          // too short
    expect(await rpc("select public.qb_help_search('%_%\\')")).toEqual([]);                                                      // wildcards are not special
  });

  it("lists related guides from the same category", async () => {
    await as(null);
    const got = await rpc("select public.qb_help_get('share-a-challenge')");
    expect(got.related.map((x: any) => x.slug)).toEqual(["create-a-competition"]);
  });

  it("counts views and votes only through the server, only for published guides", async () => {
    await as(STUDENT); await fails("select public.qb_help_track('share-a-challenge','view')", [], /permission denied/);
    await as("service");
    await rpc("select public.qb_help_track('share-a-challenge','view')"); await rpc("select public.qb_help_track('share-a-challenge','view')");
    await rpc("select public.qb_help_track('share-a-challenge','yes')"); await rpc("select public.qb_help_track('share-a-challenge','no')");
    await rpc("select public.qb_help_track('hidden-draft','view')");
    await fails("select public.qb_help_track('share-a-challenge','explode')", [], /QB_HELP_INVALID/);
    await as(OWNER);
    const rows = await rpc("select public.qb_help_admin_list()");
    expect(rows.find((r: any) => r.slug === "share-a-challenge")).toMatchObject({ views: 2, helpful_yes: 1, helpful_no: 1 });
    expect(rows.find((r: any) => r.slug === "hidden-draft").views).toBe(0);
  });

  it("edits keep the state, a published guide must be unpublished before it is deleted, and changes are audited", async () => {
    await as(OWNER);
    const rows = await rpc("select public.qb_help_admin_list()");
    const share = rows.find((r: any) => r.slug === "share-a-challenge"), draft = rows.find((r: any) => r.slug === "hidden-draft");
    const edited = await save({ id: share.id, title: "Share a challenge or competition", slug: "share-a-challenge" });
    expect(edited).toMatchObject({ title: "Share a challenge or competition", state: "published", views: 2 });
    await fails("select public.qb_help_delete($1)", [share.id], /QB_HELP_UNPUBLISH_FIRST/);
    await rpc("select public.qb_help_delete($1)", [draft.id]);
    await fails("select public.qb_help_admin_get($1)", [draft.id], /QB_NOT_FOUND/);
    await db.exec("reset role");
    expect((await q("select count(*)::int n from public.audit_logs where action like 'help.%'")).n).toBeGreaterThanOrEqual(5);
  });

  it("rolls back cleanly", async () => {
    await db.exec("reset role"); await db.exec(ROLLBACK);
    expect((await q("select to_regclass('public.help_articles')::text t")).t).toBeNull();
    expect((await q("select count(*)::int n from pg_proc where proname like 'qb_help%'")).n).toBe(0);
    await db.exec(MIGRATION);
  });
});
