import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Policies as a managed section, with versions, company-detail variables and acknowledgement (isolated PostgreSQL; the migration is applied unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261036100000_policy_cms.sql");
const ROLLBACK = read("../../supabase/rollback/policy_cms.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, ADMIN2, TEACHER, STUDENT, STUDENT2, CHILD] = [1, 2, 3, 4, 5, 6].map(id);
let db: PGlite;
const as = async (user: string | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
};
const q = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0];
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await q(sql, params)) ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
const LONG = (t: string) => `# ${t}\n\nThis is ${t} of {{company_name}}, registered in {{country}}. Questions: {{support_email}}.\n\n` + "A sentence that keeps the document long enough to be a real policy. ".repeat(6);
// Tables are closed to every browser role, so look up ids as the database owner, then go back to the signed-in role.
const doc = async (slug: string) => { await db.exec("reset role"); const r = await q("select id from public.policy_documents where slug=$1", [slug]); await db.exec("set role authenticated"); return r!.id as string; };
const detail = (key: string, value: string) => rpc("select public.qb_company_detail_save($1,$2)", [key, value]);
const draft = async (slug: string, body: string, summary = "Initial version", reack = false) =>
  rpc("select public.qb_policy_draft_save($1,$2,$3,null,$4)", [await doc(slug), body, summary, reack]);
const publish = (versionId: string) => rpc("select public.qb_policy_publish($1)", [versionId]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, email text);
    create table public.user_capabilities(user_id uuid not null, capability text not null, active boolean not null default true);
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, managed_by uuid);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, details jsonb);
    create schema quizbox_core;
    create function quizbox_core.is_staff(p_roles text[] default array['super_admin','platform_admin']) returns boolean language sql stable security definer as $$
      select auth.uid() is not null and (exists(select 1 from public.profiles where id=auth.uid() and lower(role)='owner') or exists(select 1 from public.user_capabilities where user_id=auth.uid() and active and capability = any(p_roles))) $$;
    create function quizbox_core.audit(p_action text, p_entity_type text, p_entity uuid, p_details jsonb default '{}') returns void language sql security definer as $$
      insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, details) values (auth.uid(), p_action, p_entity_type, p_entity, p_details) $$;
    grant usage on schema quizbox_core to authenticated, service_role; grant execute on function quizbox_core.is_staff(text[]), quizbox_core.audit(text, text, uuid, jsonb) to authenticated, service_role;
    insert into public.profiles values ('${OWNER}','OWNER','active','o@example.com'),('${ADMIN2}','STUDENT','active','a@example.com'),('${TEACHER}','TEACHER','active','t@example.com'),
      ('${STUDENT}','STUDENT','active','s@example.com'),('${STUDENT2}','STUDENT','active','s2@example.com'),('${CHILD}','STUDENT','active','c@example.com');
    insert into public.user_capabilities values ('${ADMIN2}','super_admin',true);
    insert into public.student_profiles(user_id, managed_by) values ('${CHILD}','${TEACHER}'),('${STUDENT}',null);
  `);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("policy section", () => {
  it("re-applies cleanly and keeps what the owner already typed", async () => {
    await as(OWNER); await detail("company_name", "QuizBox Solutions Ltd");
    await db.exec("reset role"); await db.exec(MIGRATION);
    await as(OWNER);
    expect((await rpc("select public.qb_company_details()")).find((c: any) => c.key === "company_name").value).toBe("QuizBox Solutions Ltd");
    expect((await rpc("select public.qb_policy_admin_list()")).map((d: any) => d.slug).sort()).toEqual(["cookies", "privacy", "refunds", "terms"]);
    await detail("company_name", "QuizBox Solutions");
  });

  it("is managed by owners and super admins only; nobody else can even read drafts or company details", async () => {
    const terms = await doc("terms");
    for (const who of [TEACHER, STUDENT]) {
      await as(who);
      await fails("select public.qb_policy_admin_list()", [], /QB_FORBIDDEN/);
      await fails("select public.qb_company_details()", [], /QB_FORBIDDEN/);
      await fails("select public.qb_company_detail_save('country','X')", [], /QB_FORBIDDEN/);
      await fails("select public.qb_policy_draft_save($1,'x','y',null,false)", [terms], /QB_FORBIDDEN/);
      await fails("select public.qb_policy_document_save('x-doc','Some Doc',true,true,1)", [], /QB_FORBIDDEN/);
    }
    await as(null); await fails("select public.qb_policy_admin_list()", [], /permission denied/);
    await as(ADMIN2); expect((await rpc("select public.qb_policy_admin_list()")).length).toBe(4);
    await as(STUDENT); await db.exec("set role authenticated");
    await fails("select * from public.policy_versions", [], /permission denied/);
    await fails("select * from public.policy_acceptances", [], /permission denied/);
    await fails("select * from public.company_details", [], /permission denied/);
  });

  it("refuses to publish while the text needs a company detail that is blank, and says which", async () => {
    await as(OWNER);
    const d = await draft("terms", LONG("the Terms of Use"));
    expect(d.missing).toEqual(["support_email"]);
    await fails("select public.qb_policy_publish($1)", [d.id], /QB_POLICY_VARIABLES_MISSING: support_email/);
    expect((await rpc("select public.qb_policy_public('terms')"))).toBeNull();                               // nothing live yet
    await detail("support_email", "support@quizbox.io");
    const done = await publish(d.id);
    expect(done).toMatchObject({ ok: true, slug: "terms", version_no: 1 });
    expect(done.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("shows the live text with the company details filled in, to anyone, and nothing else", async () => {
    await as(null);
    const live = await rpc("select public.qb_policy_public('terms')");
    expect(live).toMatchObject({ slug: "terms", title: "Terms of Use", version_no: 1, state: "published" });
    expect(live.body).toContain("QuizBox Solutions, registered in Ghana. Questions: support@quizbox.io.");
    expect(live.body).not.toContain("{{");
    expect(await rpc("select public.qb_policy_public('privacy')")).toBeNull();                                // a document with no live version
    expect(await rpc("select public.qb_policy_public('no-such-doc')")).toBeNull();
  });

  it("will not let a company detail used by a live policy be blanked", async () => {
    await as(OWNER);
    await fails("select public.qb_company_detail_save('support_email','  ')", [], /QB_POLICY_VARIABLE_IN_USE/);
    await detail("support_email", "help@quizbox.io");
    expect((await rpc("select public.qb_policy_public('terms')")).body).toContain("help@quizbox.io");        // an edit shows at once, without a new version
    await detail("support_email", "support@quizbox.io");
  });

  it("keeps every published version as evidence: it cannot be edited or deleted, and one draft at a time", async () => {
    await as(OWNER);
    const v1 = (await rpc("select public.qb_policy_admin_list()")).find((d: any) => d.slug === "terms").versions[0];
    await db.exec("reset role");
    await fails("update public.policy_versions set body = 'changed' where id=$1", [v1.id], /QB_POLICY_IMMUTABLE/);
    await fails("delete from public.policy_versions where id=$1", [v1.id], /QB_POLICY_IMMUTABLE/);
    await as(OWNER);
    const d1 = await draft("terms", LONG("version two of the Terms"), "Clarified payments");
    const d2 = await draft("terms", LONG("version two, edited, of the Terms"), "Clarified payments and refunds");
    expect(d2.id).toBe(d1.id); expect(d2.version_no).toBe(2);                                                  // the same draft was changed
    await fails("select public.qb_policy_publish($1)", [v1.id], /QB_POLICY_NOT_DRAFT/);
    await publish(d2.id);
    const versions = (await rpc("select public.qb_policy_admin_list()")).find((d: any) => d.slug === "terms").versions;
    expect(versions.map((v: any) => [v.version_no, v.state])).toEqual([[2, "published"], [1, "superseded"]]);
    await as(null);
    expect((await rpc("select public.qb_policy_public('terms')")).version_no).toBe(2);
    const old = await rpc("select public.qb_policy_public('terms', 1)");
    expect(old).toMatchObject({ version_no: 1, state: "superseded" });
    expect((await rpc("select public.qb_policy_public('terms')")).versions.length).toBe(2);
  });

  it("needs a real text and a summary to publish, and a draft can be discarded", async () => {
    await as(OWNER);
    const short = await draft("cookies", "Too short {{company_name}}", "Initial version");
    await fails("select public.qb_policy_publish($1)", [short.id], /QB_POLICY_TOO_SHORT/);
    const ok = await draft("cookies", LONG("the Cookie and Storage Notice"), "");
    await fails("select public.qb_policy_publish($1)", [ok.id], /QB_POLICY_SUMMARY_REQUIRED/);
    await rpc("select public.qb_policy_draft_discard($1)", [ok.id]);
    expect((await rpc("select public.qb_policy_admin_list()")).find((d: any) => d.slug === "cookies").versions).toEqual([]);
  });

  it("asks a new person to accept every required live document, and only those", async () => {
    await as(OWNER);
    const p = await draft("privacy", LONG("the Privacy Notice")); await publish(p.id);
    const r = await draft("refunds", LONG("the Refund Policy")); await publish(r.id);                         // not required
    await as(STUDENT2);
    const pending = await rpc("select public.qb_policy_pending()");
    expect(pending.map((x: any) => x.slug)).toEqual(["terms", "privacy"]);
    await rpc("select public.qb_policy_accept($1)", [`{${pending.map((x: any) => x.version_id).join(",")}}`]);
    expect(await rpc("select public.qb_policy_pending()")).toEqual([]);
    const mine = await rpc("select public.qb_policy_my_acceptances()");
    expect(mine.map((a: any) => a.slug).sort()).toEqual(["privacy", "terms"]);
    await db.exec("reset role");
    expect((await q("select count(*)::int n from public.policy_acceptances where user_id=$1 and accepted_by=$1 and length(fingerprint)=64", [STUDENT2])).n).toBe(2);
  });

  it("asks again only after a material change, not after a notice-only edit", async () => {
    await as(OWNER);
    const notice = await draft("terms", LONG("version three of the Terms"), "Fixed a typo", false); await publish(notice.id);
    await as(STUDENT2);
    expect(await rpc("select public.qb_policy_pending()")).toEqual([]);                                       // a notice does not ask again
    await as(OWNER);
    const material = await draft("terms", LONG("version four of the Terms"), "New rules for prizes", true); await publish(material.id);
    await as(STUDENT2);
    const pending = await rpc("select public.qb_policy_pending()");
    expect(pending.map((x: any) => [x.slug, x.version_no])).toEqual([["terms", 4]]);
    await rpc("select public.qb_policy_accept($1)", [`{${pending[0].version_id}}`]);
    expect(await rpc("select public.qb_policy_pending()")).toEqual([]);
    await as(STUDENT);                                                                                        // someone who accepted nothing yet starts at the latest version
    expect((await rpc("select public.qb_policy_pending()")).map((x: any) => x.slug)).toEqual(["terms", "privacy"]);
  });

  it("accepts only the live version of a live document, never a draft or a superseded one, and is safe to repeat", async () => {
    await as(OWNER);
    const old = (await rpc("select public.qb_policy_admin_list()")).find((d: any) => d.slug === "terms").versions.find((v: any) => v.state === "superseded");
    const next = await draft("terms", LONG("a draft of the Terms"), "Work in progress");
    await as(STUDENT);
    await fails("select public.qb_policy_accept($1)", [`{${old.id}}`], /QB_INVALID_POLICY/);
    await fails("select public.qb_policy_accept($1)", [`{${next.id}}`], /QB_INVALID_POLICY/);
    await fails("select public.qb_policy_accept('{}')", [], /QB_INVALID_POLICY/);
    const pending = await rpc("select public.qb_policy_pending()");
    const ids = `{${pending.map((x: any) => x.version_id).join(",")}}`;
    await rpc("select public.qb_policy_accept($1)", [ids]); await rpc("select public.qb_policy_accept($1)", [ids]);
    await db.exec("reset role");
    expect((await q("select count(*)::int n from public.policy_acceptances where user_id=$1", [STUDENT])).n).toBe(2);
    await as(OWNER); await rpc("select public.qb_policy_draft_discard($1)", [next.id]);
  });

  it("never stops a teacher-managed child at the screen; the teacher's acceptance is recorded for the child", async () => {
    await as(CHILD);
    expect(await rpc("select public.qb_policy_pending()")).toEqual([]);
    await db.exec("reset role"); await db.exec("set role service_role");
    expect(await rpc("select public.qb_policy_record_for_managed($1,$2)", [CHILD, TEACHER])).toBe(2);
    expect(await rpc("select public.qb_policy_record_for_managed($1,$2)", [CHILD, TEACHER])).toBe(0);         // repeating adds nothing
    await db.exec("reset role");
    expect((await q("select count(*)::int n from public.policy_acceptances where user_id=$1 and accepted_by=$2", [CHILD, TEACHER])).n).toBe(2);
    await as(STUDENT); await fails("select public.qb_policy_record_for_managed($1,$2)", [CHILD, STUDENT], /permission denied/);
  });

  it("audits publishing and company-detail changes", async () => {
    await db.exec("reset role");
    expect((await q("select count(*)::int n from public.audit_logs where action='policy.publish'")).n).toBeGreaterThanOrEqual(5);
    expect((await q("select count(*)::int n from public.audit_logs where action='company.detail'")).n).toBeGreaterThanOrEqual(2);
  });

  it("rolls back cleanly", async () => {
    await db.exec("reset role"); await db.exec(ROLLBACK);
    expect((await q("select to_regclass('public.policy_versions')::text t")).t).toBeNull();
    expect((await q("select count(*)::int n from pg_proc where proname like 'qb_policy%' or proname like 'qb_company%'")).n).toBe(0);
    await db.exec(MIGRATION);
  });
});
