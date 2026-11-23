import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The Help video library (migration 20261123100000): reading by guide and by role, staff-only management, links that follow a guide, server-only counters and the rollback.
// Isolated PostgreSQL; the Help centre migration and this migration are applied unchanged.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const HELP = read("../../supabase/migrations/20261039100000_help_centre.sql");
const MIGRATION = read("../../supabase/migrations/20261123100000_help_videos.sql");
const ROLLBACK = read("../../supabase/rollback/help_videos.sql");
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
const guide = (slug: string, title: string, audiences: string[] = ["everyone"]) => rpc("select public.qb_help_save(null,$1,$2,$3,$4,'classes',$5,100)", [slug, title, `How to ${title.toLowerCase()} step by step.`, BODY(title), audiences]);
const publishGuide = (g: any) => rpc("select public.qb_help_set_state($1,'published')", [g.id]);
const YT = { class: "dQw4w9WgXcQ", assign: "aqz-KE-bpKQ", gb: "M7lc1UVf-VE" };
const save = (over: Record<string, unknown> = {}) => {
  const v = { id: null, title: "Create a class in two minutes", summary: "Set up a class and share its code.", youtube: YT.class, audiences: ["teacher"], sort: 100, duration: 120, slugs: ["create-a-class"], ...over };
  return rpc("select public.qb_help_video_save($1,$2,$3,$4,$5,$6,$7,$8)", [v.id, v.title, v.summary, v.youtube, v.audiences, v.sort, v.duration, v.slugs]);
};
const vstate = (videoId: string, s: string) => rpc("select public.qb_help_video_set_state($1,$2)", [videoId, s]);

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
  await db.exec(HELP);
  await db.exec(MIGRATION);
  await as(OWNER);
  await publishGuide(await guide("create-a-class", "Create a class", ["teacher"]));
  await publishGuide(await guide("join-a-class", "Join a class", ["student"]));
  await guide("draft-guide", "A draft guide");                                                         // never published
});
afterAll(async () => { await db.close(); });

describe("help video library", () => {
  it("re-applies cleanly, and both tables are closed to every browser", async () => {
    await db.exec("reset role"); await db.exec(MIGRATION);
    await as(STUDENT); await fails("select * from public.help_videos", [], /permission denied/); await fails("select * from public.help_video_links", [], /permission denied/);
    await as(null); await fails("select * from public.help_videos", [], /permission denied/);
  });

  it("is managed by support staff only", async () => {
    await as(STUDENT);
    await fails("select public.qb_help_video_admin_list()", [], /QB_FORBIDDEN/);
    await fails("select public.qb_help_video_save(null,'A video title','',$1,array['everyone'],1,null,array[]::text[])", [YT.class], /QB_FORBIDDEN/);
    await as(null); await fails("select public.qb_help_video_admin_list()", [], /permission denied/);
    await as(SUPPORT); expect(await rpc("select public.qb_help_video_admin_list()")).toEqual([]);
  });

  it("keeps a draft hidden until it is published, and hides it again when unpublished", async () => {
    await as(OWNER);
    const v = await save();
    expect(v).toMatchObject({ title: "Create a class in two minutes", state: "draft", plays: 0, outbound: 0, slugs: ["create-a-class"] });
    await as(null);
    expect(await rpc("select public.qb_help_videos_for('create-a-class')")).toEqual([]);
    expect(await rpc("select public.qb_help_videos_list()")).toEqual([]);
    await as(SUPPORT); expect(await vstate(v.id, "published")).toEqual({ ok: true, state: "published" });
    await as(null);
    expect(await rpc("select public.qb_help_videos_for('create-a-class')")).toEqual([{ id: v.id, title: "Create a class in two minutes", summary: "Set up a class and share its code.", youtube_id: YT.class, duration_seconds: 120 }]);
    expect((await rpc("select public.qb_help_videos_list()"))[0]).toMatchObject({ youtube_id: YT.class, guide: { slug: "create-a-class", title: "Create a class" } });
    await as(OWNER); await vstate(v.id, "draft");
    await as(null); expect(await rpc("select public.qb_help_videos_for('create-a-class')")).toEqual([]);
    await as(OWNER); await vstate(v.id, "published");
  });

  it("shows a video only on a published guide it is linked to, and several videos on one guide in order", async () => {
    await as(OWNER);
    const b = await save({ title: "Join a class with a code", youtube: YT.assign, audiences: ["student"], slugs: ["join-a-class", "create-a-class"], sort: 50, summary: "" });
    await vstate(b.id, "published");
    await as(null);
    expect((await rpc("select public.qb_help_videos_for('create-a-class')")).map((x: any) => x.title)).toEqual(["Join a class with a code", "Create a class in two minutes"]);   // equal link order, then the video's own sort number (50 before 100)
    expect((await rpc("select public.qb_help_videos_for('join-a-class')")).map((x: any) => x.title)).toEqual(["Join a class with a code"]);
    expect(await rpc("select public.qb_help_videos_for('draft-guide')")).toEqual([]);                                           // an unpublished guide shows nothing
    expect(await rpc("select public.qb_help_videos_for('no-such-guide')")).toEqual([]);
  });

  it("shows each role its own videos plus the ones for everyone; a visitor sees all", async () => {
    await as(OWNER);
    const e = await save({ title: "Find your way around", youtube: YT.gb, audiences: ["everyone"], slugs: [], sort: 10 });
    await vstate(e.id, "published");
    await as(STUDENT);
    expect((await rpc("select public.qb_help_videos_list('student')")).map((x: any) => x.title)).toEqual(["Find your way around", "Join a class with a code"]);
    expect((await rpc("select public.qb_help_videos_list('teacher')")).map((x: any) => x.title)).toEqual(["Find your way around", "Create a class in two minutes"]);
    expect((await rpc("select public.qb_help_videos_list('admin')")).length).toBe(3);
    await as(null); expect((await rpc("select public.qb_help_videos_list()")).length).toBe(3);
    expect((await rpc("select public.qb_help_videos_list()")).find((x: any) => x.title === "Find your way around").guide).toBeNull();     // not linked to a guide
  });

  it("refuses a bad YouTube id, an administrator audience, a guide that does not exist and a repeat of the same video", async () => {
    await as(OWNER);
    await fails("select public.qb_help_video_save(null,'A good title','',$1,array['everyone'],1,null,array[]::text[])", ["not-an-id"], /QB_HELP_INVALID/);
    await fails("select public.qb_help_video_save(null,'A good title','',$1,array['admin'],1,null,array[]::text[])", ["abcdefghijk"], /QB_HELP_INVALID/);
    await fails("select public.qb_help_video_save(null,'ab','',$1,array['everyone'],1,null,array[]::text[])", ["abcdefghijk"], /QB_HELP_INVALID/);
    await fails("select public.qb_help_video_save(null,'A good title','',$1,array['everyone'],1,0,array[]::text[])", ["abcdefghijk"], /QB_HELP_INVALID/);
    await fails("select public.qb_help_video_save(null,'A good title','',$1,array['everyone'],1,null,array['no-such-guide'])", ["abcdefghijk"], /QB_HELP_INVALID/);
    await fails("select public.qb_help_video_save(null,'Same video again','',$1,array['everyone'],1,null,array[]::text[])", [YT.class], /QB_VIDEO_TAKEN/);
  });

  it("editing replaces the guide links and keeps the state, and a renamed guide keeps its videos", async () => {
    await as(OWNER);
    const rows = await rpc("select public.qb_help_video_admin_list()");
    const a = rows.find((r: any) => r.youtube_id === YT.assign);
    const edited = await save({ id: a.id, title: "Join a class with a code", youtube: YT.assign, audiences: ["student"], slugs: ["join-a-class"], summary: "" });
    expect(edited).toMatchObject({ state: "published", slugs: ["join-a-class"] });
    await as(null); expect((await rpc("select public.qb_help_videos_for('create-a-class')")).map((x: any) => x.youtube_id)).toEqual([YT.class]);
    await as(OWNER);
    const g = (await rpc("select public.qb_help_admin_list()")).find((r: any) => r.slug === "join-a-class");
    await rpc("select public.qb_help_save($1,'join-a-class-with-code','Join a class','How to join a class step by step.',$2,'classes',array['student'],100)", [g.id, BODY("Join a class")]);
    await as(null); expect((await rpc("select public.qb_help_videos_for('join-a-class-with-code')")).map((x: any) => x.youtube_id)).toEqual([YT.assign]);
    await fails("select public.qb_help_video_admin_list()", [], /permission denied/);                                              // the admin list is for staff, not visitors
  });

  it("counts plays and clicks only through the server, only for published videos", async () => {
    await as(STUDENT);
    await fails("select public.qb_help_video_track($1,'play')", [id(99)], /permission denied/);
    await fails("select public.qb_help_video_outbound($1)", [id(99)], /permission denied/);
    await as(OWNER);
    const rows = await rpc("select public.qb_help_video_admin_list()");
    const pub = rows.find((r: any) => r.youtube_id === YT.class);
    const draft = await save({ title: "Not ready yet", youtube: "zzzzzzzzzzz", slugs: [] });
    await as("service");
    await rpc("select public.qb_help_video_track($1,'play')", [pub.id]); await rpc("select public.qb_help_video_track($1,'play')", [pub.id]); await rpc("select public.qb_help_video_track($1,'play')", [draft.id]);
    expect(await rpc("select public.qb_help_video_outbound($1)", [pub.id])).toBe(YT.class);
    expect(await rpc("select public.qb_help_video_outbound($1, false)", [pub.id])).toBe(YT.class);                              // looked up but not counted (device already counted this hour)
    expect(await rpc("select public.qb_help_video_outbound($1)", [draft.id])).toBeNull();                                        // a draft cannot be reached
    expect(await rpc("select public.qb_help_video_outbound($1)", [id(98)])).toBeNull();
    await fails("select public.qb_help_video_track($1,'explode')", [pub.id], /QB_HELP_INVALID/);
    await as(OWNER);
    const after = await rpc("select public.qb_help_video_admin_list()");
    expect(after.find((r: any) => r.id === pub.id)).toMatchObject({ plays: 2, outbound: 1 });
    expect(after.find((r: any) => r.id === draft.id)).toMatchObject({ plays: 0, outbound: 0 });
  });

  it("a published video must be switched back to draft before it is deleted, and changes are audited", async () => {
    await as(OWNER);
    const rows = await rpc("select public.qb_help_video_admin_list()");
    const pub = rows.find((r: any) => r.youtube_id === YT.class), draft = rows.find((r: any) => r.title === "Not ready yet");
    await fails("select public.qb_help_video_delete($1)", [pub.id], /QB_HELP_UNPUBLISH_FIRST/);
    await rpc("select public.qb_help_video_delete($1)", [draft.id]);
    await fails("select public.qb_help_video_set_state($1,'published')", [draft.id], /QB_NOT_FOUND/);
    await db.exec("reset role");
    expect((await q("select count(*)::int n from public.audit_logs where action like 'help.video.%'")).n).toBeGreaterThanOrEqual(4);
  });

  it("a guide that is deleted takes its links with it, and the video stays", async () => {
    await as(OWNER);
    const g = (await rpc("select public.qb_help_admin_list()")).find((r: any) => r.slug === "draft-guide");
    const v = await save({ title: "Linked to a draft", youtube: "yyyyyyyyyyy", slugs: ["draft-guide"] });
    await rpc("select public.qb_help_delete($1)", [g.id]);
    expect((await rpc("select public.qb_help_video_admin_list()")).find((r: any) => r.id === v.id).slugs).toEqual([]);
  });

  it("rolls back cleanly and leaves the guides alone", async () => {
    await db.exec("reset role"); await db.exec(ROLLBACK);
    expect((await q("select to_regclass('public.help_videos')::text t")).t).toBeNull();
    expect((await q("select to_regclass('public.help_video_links')::text t")).t).toBeNull();
    expect((await q("select count(*)::int n from pg_proc where proname like 'qb_help_video%'")).n).toBe(0);
    expect((await q("select to_regclass('public.help_articles')::text t")).t).not.toBeNull();
  });
});
