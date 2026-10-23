import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The version 1 drafts of the Terms, Privacy Notice, Cookie Notice and Refund Policy on top of the policy section (isolated PostgreSQL; both migrations applied unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261036100000_policy_cms.sql");
const SEED = read("../../supabase/migrations/20261037100000_policy_seed_v1.sql");
const SEED_ROLLBACK = read("../../supabase/rollback/policy_seed_v1.sql");
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

beforeAll(async () => { await db.exec(SEED); });

describe("version 1 drafts of the legal documents", () => {
  it("are saved as drafts, one per document, and nothing is live", async () => {
    await as(OWNER);
    const docs = await rpc("select public.qb_policy_admin_list()");
    for (const slug of ["terms", "privacy", "refunds", "cookies"]) {
      const d = docs.find((x: any) => x.slug === slug);
      expect(d.versions.map((v: any) => [v.version_no, v.state, v.summary])).toEqual([[1, "draft", "Initial version"]]);
    }
    await as(null);
    for (const slug of ["terms", "privacy", "refunds", "cookies"]) expect(await rpc("select public.qb_policy_public($1)", [slug])).toBeNull();
  });

  it("use only company details that exist, and every text is substantial", async () => {
    await db.exec("reset role");
    const keys = (await db.query<{ key: string }>("select key from public.company_details")).rows.map((r) => r.key);
    const bodies = (await db.query<{ slug: string; body: string }>("select d.slug, v.body from public.policy_versions v join public.policy_documents d on d.id=v.document_id")).rows;
    expect(bodies.length).toBe(4);
    for (const b of bodies) {
      const used = [...b.body.matchAll(/\{\{([a-z0-9_]+)\}\}/g)].map((m) => m[1]);
      expect(used.length, b.slug).toBeGreaterThan(0);
      for (const k of used) expect(keys, `${b.slug} uses {{${k}}}`).toContain(k);
      expect(b.body.length, b.slug).toBeGreaterThan(1000);
      expect(b.body, b.slug).toContain("Issued by {{company_name}}, {{country}}.");
    }
  });

  it("cannot be published until the company details are filled in, and the refusal names what is missing", async () => {
    await as(OWNER);
    const terms = (await rpc("select public.qb_policy_admin_list()")).find((x: any) => x.slug === "terms").versions[0];
    expect(terms.missing).toEqual(expect.arrayContaining(["registration_number", "registered_address", "support_email"]));
    await expect(db.query("select public.qb_policy_publish($1)", [terms.id])).rejects.toThrow(/QB_POLICY_VARIABLES_MISSING: .*registered_address/);
    const privacy = (await rpc("select public.qb_policy_admin_list()")).find((x: any) => x.slug === "privacy").versions[0];
    expect(privacy.missing).toEqual(expect.arrayContaining(["dpc_registration", "dpo_contact", "data_location", "retention_tickets", "retention_inactive", "retention_attempts"]));
  });

  it("publish once every detail is filled in, with no placeholder left in the live text", async () => {
    await as(OWNER);
    const values: Record<string, string> = { registration_number: "CS-TEST-0001", registered_address: "1 Test Road, Accra", support_email: "support@example.com", dpo_contact: "Data Protection Contact, privacy@example.com",
      dpc_registration: "DPC-TEST-0001", data_location: "the European Union and the United States", retention_tickets: "two years", retention_inactive: "three years", retention_attempts: "five years" };
    for (const [k, v] of Object.entries(values)) await rpc("select public.qb_company_detail_save($1,$2)", [k, v]);
    const docs = await rpc("select public.qb_policy_admin_list()");
    for (const d of docs) { expect(d.versions[0].missing, d.slug).toEqual([]); await rpc("select public.qb_policy_publish($1)", [d.versions[0].id]); }
    await as(null);
    for (const slug of ["terms", "privacy", "refunds", "cookies"]) {
      const p = await rpc("select public.qb_policy_public($1)", [slug]);
      expect(p.version_no, slug).toBe(1); expect(p.body, slug).not.toContain("{{"); expect(p.body, slug).toContain("Issued by QuizBox Solutions, Ghana.");
    }
    expect((await rpc("select public.qb_policy_public('privacy')")).body).toContain("registered with the Data Protection Commission under number DPC-TEST-0001");
    expect((await rpc("select public.qb_policy_public('terms')")).body).toContain("1 Test Road, Accra");
  });

  it("then ask a new person to accept the Terms and the Privacy Notice only", async () => {
    await as(STUDENT2);
    expect((await rpc("select public.qb_policy_pending()")).map((p: any) => p.slug)).toEqual(["terms", "privacy"]);
  });

  it("do not overwrite an edit when the seed is applied again", async () => {
    await as(OWNER);
    const cookies = (await rpc("select public.qb_policy_admin_list()")).find((x: any) => x.slug === "cookies");
    const draft = await rpc("select public.qb_policy_draft_save($1,$2,'Edited',null,false)", [cookies.id, "# Cookie and Storage Notice\n\n" + "Edited text. ".repeat(40)]);
    await db.exec("reset role"); await db.exec(SEED);
    await as(OWNER);
    const got = await rpc("select public.qb_policy_admin_get($1)", [draft.id]);
    expect(got.body.startsWith("# Cookie and Storage Notice\n\nEdited text.")).toBe(true);
    expect((await rpc("select public.qb_policy_admin_list()")).find((x: any) => x.slug === "cookies").versions.length).toBe(2);
  });

  it("the seed rollback removes only untouched version 1 drafts", async () => {
    await db.exec("reset role"); await db.exec(SEED_ROLLBACK);
    expect((await q("select count(*)::int n from public.policy_versions where state='published'")).n).toBe(4);   // published versions are evidence and stay
  });
});
