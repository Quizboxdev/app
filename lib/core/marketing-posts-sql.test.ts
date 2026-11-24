import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Marketing posts: public reading of published posts only, staff-only management, publishing, deleting (isolated PostgreSQL; the migration is applied unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261124120000_marketing_posts.sql");
const ROLLBACK = read("../../supabase/rollback/marketing_posts.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, SUPPORT, STUDENT] = [1, 2, 3].map(id);
const FLYER = "123e4567-e89b-42d3-a456-426614174000.png";
let db: PGlite;
const as = async (user: string | "service" | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user && user !== "service" ? user : ""]);
  await db.exec(user === "service" ? "set role service_role" : user ? "set role authenticated" : "set role anon");
};
const q = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0];
const su = async (sql: string) => { await db.exec("reset role"); return q(sql); };   // direct table reads, as the database owner
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await q(sql, params)) ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
const BODY = "First paragraph about the news.\n\nSecond paragraph with more detail about what changed for learners.";
const save = (over: Record<string, unknown> = {}) => {
  const a = { id: null, slug: "big-news", title: "Big news for learners", summary: "Practice papers are now live for every subject.", body: BODY, flyer: FLYER, alt: "A flyer", ...over };
  return rpc("select public.qb_post_save($1,$2,$3,$4,$5,$6,$7)", [a.id, a.slug, a.title, a.summary, a.body, a.flyer, a.alt]);
};
const state = (postId: string, s: string) => rpc("select public.qb_post_set_state($1,$2)", [postId, s]);

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

describe("marketing posts", () => {
  it("a draft is invisible to the public; publishing makes it readable with its flyer and date", async () => {
    await as(SUPPORT);
    const draft = await save();
    expect(draft.state).toBe("draft");
    await as(null);
    expect(await rpc("select public.qb_post_get('big-news')")).toBeNull();
    expect(await rpc("select public.qb_post_list()")).toEqual([]);
    await as(SUPPORT);
    expect((await state(draft.id, "published")).slug).toBe("big-news");
    await as(null);
    const got = await rpc("select public.qb_post_get('Big-News')");   // the web name is not case sensitive
    expect(got).toMatchObject({ slug: "big-news", title: "Big news for learners", flyer_path: FLYER, flyer_alt: "A flyer" });
    expect(got.published_at).toBeTruthy();
    expect((await rpc("select public.qb_post_list()")).map((p: any) => p.slug)).toEqual(["big-news"]);
  });
  it("only staff can list, read, save, publish or delete", async () => {
    const postId = (await su("select id from public.marketing_posts limit 1")).id;
    for (const who of [STUDENT, null] as const) {
      await as(who);
      await fails("select public.qb_post_admin_list()", [], /QB_FORBIDDEN|permission denied/);
      await fails("select public.qb_post_admin_get($1)", [postId], /QB_FORBIDDEN|permission denied/);
      await fails("select public.qb_post_save(null,'x-y','Title here','A summary long enough',$1,null,null)", [BODY], /QB_FORBIDDEN|permission denied/);
      await fails("select public.qb_post_set_state($1,'draft')", [postId], /QB_FORBIDDEN|permission denied/);
      await fails("select public.qb_post_delete($1)", [postId], /QB_FORBIDDEN|permission denied/);
      await fails("select * from public.marketing_posts", [], /permission denied/);
    }
  });
  it("rejects bad input with plain codes and a taken web name", async () => {
    await as(SUPPORT);
    await fails("select public.qb_post_save(null,'Bad Name','Title here','A summary long enough',$1,null,null)", [BODY], /QB_POST_INVALID/);
    await fails("select public.qb_post_save(null,'ok-name','Hi','A summary long enough',$1,null,null)", [BODY], /QB_POST_INVALID/);
    await fails("select public.qb_post_save(null,'ok-name','Title here','short',$1,null,null)", [BODY], /QB_POST_INVALID/);
    await fails("select public.qb_post_save(null,'ok-name','Title here','A summary long enough',$1,'../evil.png',null)", [BODY], /QB_POST_INVALID/);
    await fails("select public.qb_post_save(null,'big-news','Another title','Another summary that is long enough',$1,null,null)", [BODY], /QB_POST_SLUG_TAKEN/);
  });
  it("editing keeps the same post, a flyer can be removed, and switching to draft hides it again", async () => {
    const postId = (await su("select id from public.marketing_posts where slug='big-news'")).id;
    await as(SUPPORT);
    const edited = await save({ id: postId, title: "Bigger news for learners", flyer: "" });
    expect(edited).toMatchObject({ id: postId, title: "Bigger news for learners", flyer_path: null });
    await state(postId, "draft");
    await as(null);
    expect(await rpc("select public.qb_post_get('big-news')")).toBeNull();
  });
  it("a published post cannot be deleted; a draft can, and both steps are audited", async () => {
    const postId = (await su("select id from public.marketing_posts where slug='big-news'")).id;
    await as(SUPPORT);
    await state(postId, "published");
    await fails("select public.qb_post_delete($1)", [postId], /QB_POST_UNPUBLISH_FIRST/);
    await state(postId, "draft");
    await db.query("select public.qb_post_delete($1)", [postId]);
    expect((await su("select count(*)::int as n from public.marketing_posts")).n).toBe(0);
    await db.exec("reset role");
    expect((await db.query<{ action: string }>("select action from public.audit_logs order by action")).rows.map((r) => r.action)).toEqual(expect.arrayContaining(["post.published", "post.draft", "post.delete"]));
  });
  it("the rollback removes everything it added", async () => {
    await db.exec("reset role");
    await db.exec(ROLLBACK);
    expect((await q("select to_regclass('public.marketing_posts') is null as gone")).gone).toBe(true);
    expect((await q("select to_regprocedure('public.qb_post_get(text)') is null as gone")).gone).toBe(true);
  });
});
