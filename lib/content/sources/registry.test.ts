import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeliveryFixture } from "../../competition/fixtures/database";

// Isolated PostgreSQL: multi-country curriculum source registry over the real market, factory and source SQL.
// Markets: Ghana (fixture), Nigeria, Kenya — each with its own authority and curriculum. id(2) = OWNER (Super Admin).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
let db: PGlite;
async function as(user: string | null) { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]); await db.exec(user ? "set role authenticated" : "set role anon"); }
const sql = async <T = any>(text: string, args: unknown[] = []) => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub','',false)"); return (await db.query<T>(text, args)).rows; };
const sources = async <T = any>(action: string, data: Record<string, unknown> = {}) => (await db.query<{ v: T }>("select public.qb_curriculum_sources($1,$2::jsonb) v", [action, JSON.stringify(data)])).rows[0].v;
const pdf = (subject: string, url: string, level = "JHS (Basic 7-9)", extra: Record<string, string> = {}) => ({ level, subject, title: `${subject} curriculum`, url, source_type: "official PDF", status: "verified", ...extra });
const pack = (name: string, groups: Array<{ country: string; rows: any[] }>, type = groups.length > 1 ? "MULTI_COUNTRY_PACK" : "COUNTRY_PACK") =>
  ({ name, package_type: type, file_name: `${name}.zip`, sha256: [...name].map((c) => c.charCodeAt(0).toString(16)).join("").padEnd(64, "0").slice(0, 64), research_date: "2026-10-03", notes: [], attachments: [], groups });

describe("multi-country curriculum source registry", () => {
  const m: Record<string, { market: string; curriculum: string; authority: string }> = {};
  const ghana = () => pack("ghana-pack", [{ country: "Ghana", rows: [pdf("Computing", "https://nacca.gov.gh/computing.pdf"), pdf("Mathematics", "https://nacca.gov.gh/maths.pdf"),
    { ...pdf("Official CCP index", "https://nacca.gov.gh/ccp/"), source_type: "official index" }, { ...pdf("Social Studies", "https://nacca.gov.gh/ccp/#social"), source_type: "official index", status: "listed on official index; direct PDF URL not independently confirmed" },
    pdf("Computing", "https://nacca.gov.gh/computing.pdf"), pdf("Science", "https://mirror.example.com/science.pdf"), pdf("Physics", "https://nacca.gov.gh/physics.pdf", "SHS (Secondary Education)")] }]);
  const nigeria = () => pack("nigeria-pack", [{ country: "Nigeria", rows: [pdf("Computer Studies", "https://nerdc.gov.ng/computer.pdf", "JSS"), pdf("Mathematics", "https://nerdc.gov.ng/maths.pdf", "JSS")] }]);
  const kenya = () => pack("kenya-pack", [{ country: "KE", rows: [pdf("Computer Science", "https://kicd.ac.ke/cs.pdf", "Junior School")] }]);
  const mapping = () => ({ [m.Ghana.market]: { "JHS (Basic 7-9)": m.Ghana.curriculum }, [m.Nigeria.market]: { JSS: m.Nigeria.curriculum }, [m.Kenya.market]: { "Junior School": m.Kenya.curriculum } });

  beforeAll(async () => {
    let market: string; ({ db, market } = await createDeliveryFixture());
    await db.exec("reset role");
    await db.exec(`alter table curriculum_nodes add column if not exists parent_id uuid;
      alter table content_import_batches alter column id set default gen_random_uuid(), add column if not exists source_file text, add column if not exists source_hash text unique, add column if not exists status text,
        add column if not exists started_at timestamptz default now(), add column if not exists completed_at timestamptz, add column if not exists records_detected int, add column if not exists valid_records int,
        add column if not exists warning_records int, add column if not exists rejected_records int, add column if not exists inserted_records int, add column if not exists updated_records int,
        add column if not exists duplicates_skipped int, add column if not exists report jsonb default '{}', add column if not exists source_type text, add column if not exists provider text, add column if not exists model_version text;
      create table if not exists question_import_staging(id uuid primary key default gen_random_uuid(),import_batch_id uuid not null,row_number int not null,external_source_id text,normalized_payload jsonb not null,fingerprint text not null,classification text not null,issues jsonb,imported_question_id uuid,created_at timestamptz default now());
      alter table source_documents alter column id set default gen_random_uuid(), add column if not exists document_type text, add column if not exists ownership_type text, add column if not exists created_at timestamptz default now();`);
    const security = read("../../../supabase/migrations/20261002170000_production_readiness_security.sql");
    const start = security.indexOf("CREATE OR REPLACE FUNCTION public.qb_content_ingest("), end = security.indexOf("end $function$", start) + "end $function$".length;
    await db.exec(security.slice(start, end).replace("public.qb_content_ingest(", "quizbox_private.core_qb_content_ingest(").replace(" perform quizbox_private.enforce_budget('qb_content_ingest',20,3600);", " p_spec:=quizbox_market.generation_context(p_spec);") + ";");
    await db.exec(read("../../../supabase/migrations/20261005100000_content_factory.sql"));
    await db.exec(read("../../../supabase/migrations/20261006100000_curriculum_source_registry.sql"));
    const ghAuthority = (await db.query<{ id: string }>("select id from curriculum_authorities where market_id=$1 limit 1", [market])).rows[0].id;
    await db.query("update curriculum_authorities set official_domains='{nacca.gov.gh}' where id=$1", [ghAuthority]);
    const ghCurriculum = randomUUID();
    await db.query("insert into curricula(id,code,country,market_id) values($1,'GH-CCP','Ghana',$2)", [ghCurriculum, market]);
    await db.query("insert into market_curricula(curriculum_id,market_id,authority_id,active) values($1,$2,$3,true)", [ghCurriculum, market, ghAuthority]);
    m.Ghana = { market, curriculum: ghCurriculum, authority: ghAuthority };
    for (const [name, iso2, iso3, currency, authorityCode, domain, curriculumCode] of [["Nigeria", "NG", "NGA", "NGN", "NERDC", "nerdc.gov.ng", "NG-BEC"], ["Kenya", "KE", "KEN", "KES", "KICD", "kicd.ac.ke", "KE-CBC"]]) {
      await db.query("insert into currencies values($1,$2,$3,2,true) on conflict do nothing", [currency, `${name} currency`, currency]);
      const country = (await db.query<{ id: string }>("insert into countries(iso2_code,iso3_code,name,default_currency_code,timezone,locale) values($1,$2,$3,$4,'UTC','en') returning id", [iso2, iso3, name, currency])).rows[0].id;
      const mk = (await db.query<{ id: string }>("insert into markets(country_id,name,default_currency_code,timezone,locale,status) values($1,$2,$3,'UTC','en','ACTIVE') returning id", [country, name, currency])).rows[0].id;
      const authority = (await db.query<{ id: string }>("insert into curriculum_authorities(market_id,code,name,official_domains) values($1,$2,$2,$3) returning id", [mk, authorityCode, [domain]])).rows[0].id;
      const curriculum = randomUUID();
      await db.query("insert into curricula(id,code,country,market_id) values($1,$2,$3,$4)", [curriculum, curriculumCode, name, mk]);
      await db.query("insert into market_curricula(curriculum_id,market_id,authority_id,active) values($1,$2,$3,true)", [curriculum, mk, authority]);
      m[name] = { market: mk, curriculum, authority };
    }
    await db.query("insert into user_capabilities(user_id,capability,active) values($1,'content_admin',true)", [id(3)]);
  }, 180_000);
  afterAll(async () => { await db?.close(); });

  it("lists target countries from market configuration and is Super Admin only", async () => {
    await as(id(4)); await expect(sources("options")).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(id(2));
    const options = await sources<Array<{ country: string; curricula: Array<{ code: string; authority: string }> }>>("options");
    expect(options.map((o) => o.country).sort()).toEqual(["Ghana", "Kenya", "Nigeria"]);
    expect(options.find((o) => o.country === "Nigeria")!.curricula).toEqual([expect.objectContaining({ code: "NG-BEC", authority: "NERDC" })]);
  });

  it("previews a country pack with counts, duplicates, index-only, pending and warnings before anything is written", async () => {
    await as(id(2));
    const unmapped = await sources("preview", { package: ghana(), target_market_id: m.Ghana.market });
    expect(unmapped.groups[0].rows.filter((r: any) => r.issue === "CURRICULUM_NOT_MAPPED")).toHaveLength(6);
    const preview = await sources("preview", { package: ghana(), target_market_id: m.Ghana.market, mapping: mapping() });
    expect(preview.groups[0]).toMatchObject({ country: "Ghana", market: "Ghana", totals: { sources: 7, importable: 4, verified_pdfs: 2, index_only: 2, pending: 1, duplicates: 1, warnings: 2 } });
    expect(preview.groups[0].rows.map((r: any) => r.issue).filter(Boolean).sort()).toEqual(["CURRICULUM_NOT_MAPPED", "DUPLICATE_IN_PACKAGE", "HOST_NOT_OFFICIAL"]);
    expect((await sql("select count(*)::int n from quizbox_sources.registry"))[0].n).toBe(0);
  });

  it("denies a wrong-country import and requires explicit confirmation", async () => {
    await as(id(2));
    await expect(sources("import", { package: ghana(), target_market_id: m.Nigeria.market, mapping: mapping(), confirm: true })).rejects.toThrow("QB_SOURCE_COUNTRY_MISMATCH");
    await expect(sources("preview", { package: kenya(), target_market_id: m.Ghana.market })).rejects.toThrow("QB_SOURCE_COUNTRY_MISMATCH");
    await expect(sources("import", { package: ghana(), target_market_id: m.Ghana.market, mapping: mapping() })).rejects.toThrow("QB_IMPORT_CONFIRMATION_REQUIRED");
  });

  it("imports Ghana into Ghana only, Nigeria into Nigeria only and Kenya into Kenya only", async () => {
    await as(id(2));
    for (const [p, target] of [[ghana(), m.Ghana.market], [nigeria(), m.Nigeria.market], [kenya(), m.Kenya.market]] as const) await sources("import", { package: p, target_market_id: target, mapping: mapping(), confirm: true });
    const rows = await sql<{ market: string; country: string; source_country: string; curriculum: string; status: string; source_type: string; n: number }>(`select mk.name market,c.name country,sc.name source_country,k.code curriculum,g.status,g.source_type,count(*)::int n
      from quizbox_sources.registry g join markets mk on mk.id=g.market_id join countries c on c.id=g.country_id join countries sc on sc.id=g.source_country_id join curricula k on k.id=g.curriculum_id group by 1,2,3,4,5,6 order by 1,5,6`);
    expect(rows).toEqual([
      { market: "Ghana", country: "Ghana", source_country: "Ghana", curriculum: "GH-CCP", status: "DIRECT_PDF_PENDING", source_type: "OFFICIAL_INDEX", n: 1 },
      { market: "Ghana", country: "Ghana", source_country: "Ghana", curriculum: "GH-CCP", status: "IMPORTED", source_type: "OFFICIAL_INDEX", n: 1 },
      { market: "Ghana", country: "Ghana", source_country: "Ghana", curriculum: "GH-CCP", status: "IMPORTED", source_type: "OFFICIAL_PDF", n: 2 },
      { market: "Kenya", country: "Kenya", source_country: "Kenya", curriculum: "KE-CBC", status: "IMPORTED", source_type: "OFFICIAL_PDF", n: 1 },
      { market: "Nigeria", country: "Nigeria", source_country: "Nigeria", curriculum: "NG-BEC", status: "IMPORTED", source_type: "OFFICIAL_PDF", n: 2 }]);
    await as(id(2)); await expect(sources("import", { package: ghana(), target_market_id: m.Ghana.market, mapping: mapping(), confirm: true })).rejects.toThrow("QB_PACKAGE_ALREADY_IMPORTED_FOR_MARKET");
  });

  it("splits a consolidated multi-country pack into one isolated job per country", async () => {
    await as(id(2));
    const multi = pack("six-country-pack", [{ country: "Ghana", rows: [pdf("Science", "https://nacca.gov.gh/science.pdf")] }, { country: "Nigeria", rows: [pdf("Basic Science", "https://nerdc.gov.ng/science.pdf", "JSS")] },
      { country: "Kenya", rows: [pdf("Integrated Science", "https://kicd.ac.ke/science.pdf", "Junior School")] }, { country: "Atlantis", rows: [pdf("Science", "https://atlantis.example/s.pdf")] }]);
    const only = await sources("preview", { package: multi, target_market_id: m.Nigeria.market, mapping: mapping() });
    expect(only.groups.map((g: any) => [g.country, g.market ?? null, g.warnings])).toEqual([["Ghana", null, ["NOT_TARGET_COUNTRY"]], ["Nigeria", "Nigeria", []], ["Kenya", null, ["NOT_TARGET_COUNTRY"]], ["Atlantis", null, ["COUNTRY_NOT_CONFIGURED"]]]);
    const result = await sources("import", { package: multi, mapping: mapping(), confirm: true });
    expect(result.jobs.map((j: any) => [j.country, j.status, j.imported ?? 0])).toEqual([["Ghana", "IMPORTED", 1], ["Nigeria", "IMPORTED", 1], ["Kenya", "IMPORTED", 1], ["Atlantis", "NOT_IMPORTED", 0]]);
    const leaks = await sql<{ n: number }>("select count(*)::int n from quizbox_sources.registry g join markets mk on mk.id=g.market_id where g.source_country_id<>mk.country_id or g.country_id<>mk.country_id");
    expect(leaks[0].n).toBe(0);
    expect((await sql<{ n: number }>("select count(distinct j.market_id)::int n from quizbox_sources.ingestion_jobs j join quizbox_sources.packages p on p.id=j.package_id where p.name='six-country-pack'"))[0].n).toBe(3);
  });

  it("enforces isolation in the database even for direct writes", async () => {
    const job = (await sql<{ id: string; package_id: string }>("select id,package_id from quizbox_sources.ingestion_jobs where market_id=$1 limit 1", [m.Nigeria.market]))[0];
    const ghanaCountry = (await sql<{ country_id: string }>("select country_id from markets where id=$1", [m.Ghana.market]))[0].country_id;
    const nigeriaCountry = (await sql<{ country_id: string }>("select country_id from markets where id=$1", [m.Nigeria.market]))[0].country_id;
    const insert = (source: string, country: string, market: string, curriculum: string, authority: string) => sql(`insert into quizbox_sources.registry(job_id,package_id,source_country_id,country_id,market_id,authority_id,curriculum_id,education_level,subject_code,title,canonical_url,source_type,verification_status,status)
      values($1,$2,$3,$4,$5,$6,$7,'JSS','Maths','x','https://nerdc.gov.ng/x-${randomUUID()}.pdf','OFFICIAL_PDF','VERIFIED','IMPORTED')`, [job.id, job.package_id, source, country, market, authority, curriculum]);
    await expect(insert(ghanaCountry, nigeriaCountry, m.Nigeria.market, m.Nigeria.curriculum, m.Nigeria.authority)).rejects.toThrow("QB_SOURCE_COUNTRY_MISMATCH");
    await expect(insert(nigeriaCountry, ghanaCountry, m.Nigeria.market, m.Nigeria.curriculum, m.Nigeria.authority)).rejects.toThrow("QB_SOURCE_MARKET_COUNTRY_MISMATCH");
    await expect(insert(nigeriaCountry, nigeriaCountry, m.Nigeria.market, m.Ghana.curriculum, m.Ghana.authority)).rejects.toThrow("QB_SOURCE_CURRICULUM_NOT_IN_MARKET");
  });

  it("runs fetch -> extract -> map -> review -> approve -> activate, superseding the previous active source", async () => {
    await as(id(2));
    const claimed = await sources<Array<{ id: string; token: string; url: string; official_domains: string[] }>>("claim_fetch", { market_id: m.Ghana.market, limit: 5 });
    expect(claimed.map((c) => c.url).sort()).toEqual(["https://nacca.gov.gh/computing.pdf", "https://nacca.gov.gh/maths.pdf", "https://nacca.gov.gh/science.pdf"]);
    expect(claimed[0].official_domains).toEqual(["nacca.gov.gh"]);
    const computing = claimed.find((c) => c.url.endsWith("computing.pdf"))!;
    const text = "Strand 1: Introduction to computing. ".repeat(20);
    await expect(sources("finish_fetch", { id: computing.id, token: computing.token, sha256: "a".repeat(64), bytes: 1000, pages: 3, storage_path: `${m.Nigeria.market}/${randomUUID()}.pdf`, text })).rejects.toThrow("QB_SOURCE_FETCH_RESULT_INVALID");
    const fetched = await sources("finish_fetch", { id: computing.id, token: computing.token, sha256: "a".repeat(64), bytes: 1000, pages: 3, storage_path: `${m.Ghana.market}/${randomUUID()}.pdf`, text });
    expect(fetched).toMatchObject({ status: "NEEDS_REVIEW", market: "Ghana", curriculum: "GH-CCP", pages: 3 });
    for (const c of claimed.filter((c) => c !== computing)) await sources("fail_fetch", { id: c.id, token: c.token, error_code: "FETCH_TIMEOUT" });
    await expect(sources("review", { id: computing.id, decision: "approve", note: "Matches NaCCA publication." })).rejects.toThrow("QB_SOURCE_RIGHTS_ATTESTATION_REQUIRED");
    await sources("review", { id: computing.id, decision: "approve", note: "Matches NaCCA publication.", rights_confirmed: true });
    expect(await sources("activate", { id: computing.id })).toMatchObject({ status: "ACTIVE" });
    expect((await sql<{ validation_status: string }>("select d.validation_status from source_documents d join quizbox_sources.registry g on g.source_document_id=d.id where g.id=$1", [computing.id]))[0].validation_status).toBe("approved");
    // A corrected re-publication (new URL) for the same curriculum/level/subject supersedes the active one.
    await as(id(2));
    const reissue = pack("ghana-reissue", [{ country: "Ghana", rows: [pdf("Computing", "https://nacca.gov.gh/computing-2026.pdf")] }]);
    const imported = await sources<{ jobs: Array<{ job_id: string }> }>("import", { package: reissue, target_market_id: m.Ghana.market, mapping: mapping(), confirm: true });
    const [second] = await sources<Array<{ id: string; token: string }>>("claim_fetch", { job_id: imported.jobs[0].job_id, limit: 1 });
    await sources("finish_fetch", { id: second.id, token: second.token, sha256: "b".repeat(64), bytes: 1200, pages: 4, storage_path: `${m.Ghana.market}/${randomUUID()}.pdf`, text });
    await sources("review", { id: second.id, decision: "approve", note: "2026 re-issue.", rights_confirmed: true });
    await sources("activate", { id: second.id });
    expect((await sql<{ status: string; vs: string }>("select g.status,d.validation_status vs from quizbox_sources.registry g join source_documents d on d.id=g.source_document_id where g.id=$1", [computing.id]))[0]).toEqual({ status: "SUPERSEDED", vs: "rejected" });
    const trail = await sql<{ action: string }>("select action from quizbox_sources.events where registry_id=$1 order by id", [computing.id]);
    expect(trail.map((t) => t.action)).toEqual(["IMPORTED", "FETCHED", "EXTRACTED", "MAPPED", "NEEDS_REVIEW", "APPROVED", "ACTIVE", "SUPERSEDED"]);
    await expect(sql("update quizbox_sources.events set action='X'")).rejects.toThrow("QB_IMMUTABLE_HISTORY");
  });

  it("resolves direct-PDF-pending sources only on the authority's official host", async () => {
    const [pending] = await sql<{ id: string }>("select id from quizbox_sources.registry where status='DIRECT_PDF_PENDING' and market_id=$1", [m.Ghana.market]);
    await as(id(2));
    await expect(sources("set_direct_url", { id: pending.id, url: "https://mirror.example.com/social.pdf", note: "Found it" })).rejects.toThrow("QB_SOURCE_HOST_NOT_OFFICIAL");
    expect(await sources("set_direct_url", { id: pending.id, url: "https://nacca.gov.gh/wp-content/social-studies.pdf", note: "Direct PDF confirmed on NaCCA." })).toMatchObject({ status: "IMPORTED", verification_status: "VERIFIED" });
  });

  it("shows Content Factory only the active sources of the selected market and curriculum", async () => {
    await as(id(2));
    const gh = await db.query<{ v: any[] }>("select public.qb_content_factory_sources($1,$2) v", [m.Ghana.market, m.Ghana.curriculum]);
    expect(gh.rows[0].v.map((s) => [s.title, s.level, s.subject, s.registry_status])).toEqual([["Computing curriculum", "JHS (Basic 7-9)", "Computing", "ACTIVE"]]);
    const ng = await db.query<{ v: any[] }>("select public.qb_content_factory_sources($1,$2) v", [m.Nigeria.market, m.Nigeria.curriculum]);
    expect(ng.rows[0].v).toEqual([]);
    await as(id(4)); await expect(db.query("select public.qb_content_factory_sources($1,$2)", [m.Ghana.market, m.Ghana.curriculum])).rejects.toThrow("QB_FACTORY_ACCESS_DENIED");
    // A campaign cannot use another country's source, nor a source outside its subjects.
    await as(id(2));
    const ghSource = gh.rows[0].v[0].id;
    const base = { name: "Isolation check", curriculum_id: m.Ghana.curriculum, target_question_count: 10, batch_size: 10, provider: "mock", model: "fixture", difficulty_mix: { easy: 100 }, cognitive_mix: { Recall: 100 } };
    await expect(db.query("select public.qb_content_factory('create',$1::jsonb)", [JSON.stringify({ ...base, market_id: m.Nigeria.market, curriculum_id: m.Nigeria.curriculum, source_scope: { source_document_ids: [ghSource] } })])).rejects.toThrow(/QB_CONTENT_SOURCE_DENIED|QB_FACTORY_SOURCE_CURRICULUM_MISMATCH/);
    await expect(db.query("select public.qb_content_factory('create',$1::jsonb)", [JSON.stringify({ ...base, market_id: m.Ghana.market, source_scope: { source_document_ids: [ghSource], subject_codes: ["Mathematics"] } })])).rejects.toThrow("QB_FACTORY_SOURCE_SUBJECT_MISMATCH");
  });

  it("reports curriculum source readiness per market and lets content admins read the registry", async () => {
    await as(id(2));
    const readiness = async (market: string) => (await db.query<{ v: any }>("select public.qb_market_admin('readiness',jsonb_build_object('market_id',$1::uuid)) v", [market])).rows[0].v;
    const gh = await readiness(m.Ghana.market), ke = await readiness(m.Kenya.market);
    expect(gh.sources).toMatchObject({ active: 1, by_curriculum: [{ curriculum: "GH-CCP", active: 1 }] });
    expect(gh.blockers).not.toContain("CURRICULUM_SOURCE_MISSING");
    expect(ke.sources).toMatchObject({ active: 0, pending: 2 }); expect(ke.blockers).toContain("CURRICULUM_SOURCE_MISSING");
    await as(id(3));
    const list = await sources<{ rows: any[]; by_status: Record<string, number> }>("list", { market_id: m.Kenya.market });
    expect(list.rows.every((r) => r.market === "Kenya")).toBe(true);
    await expect(sources("import", { package: kenya(), confirm: true })).rejects.toThrow("SUPER_ADMIN_REQUIRED");
  });
});
