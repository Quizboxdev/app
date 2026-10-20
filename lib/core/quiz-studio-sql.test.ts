import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Quiz Studio: classified material, chapters, the reader, joining, templates, logos, the sponsored feed and library counts (isolated PostgreSQL; migrations applied in order, unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const CHAIN = ["20261021100000_challenges_foundation", "20261022100000_challenges_extensions", "20261023100000_challenges_moderation", "20261027100000_competitions_and_sharing"].map((n) => read(`../../supabase/migrations/${n}.sql`));
const MIGRATION = read("../../supabase/migrations/20261029100000_quiz_studio.sql");
const ROLLBACK = read("../../supabase/rollback/quiz_studio.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, TEACHER, SPONSOR, LEARNER, CLASSMATE, OUTSIDER, CHILD] = [1, 2, 3, 4, 5, 6, 7].map(id);
const CLASS = id(100);
let db: PGlite;
const as = async (user: string | null | "service") => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user && user !== "service" ? user : ""]);
  await db.exec(user === "service" ? "set role service_role" : user ? "set role authenticated" : "set role anon");
};
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(sql, params)).rows[0] ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
const sup = async (text: string, params: unknown[] = []) => { await db.exec("reset role"); return (await db.query<any>(text, params)).rows; };
const chunks = (n = 6) => Array.from({ length: n }, (_, i) => ({ heading: i < n / 2 ? "Chapter 1" : "Chapter 2", body: `Passage number ${i + 1} of the story about the river and the harvest.` }));
const sections = [{ title: "Chapter 1: The River", first: 1, last: 3 }, { title: "Chapter 2: The Harvest", first: 4, last: 6 }];
const addDoc = (campaign: string, type = "story_book", secs: unknown = sections, n = 6, asset: string | null = null) =>
  rpc("select public.challenge_content_add($1,'The River Story','book','story.txt','',$2,true,$3,$4,$5)", [campaign, JSON.stringify(chunks(n)), asset, type, secs ? JSON.stringify(secs) : null]);
const qs = (n = 3) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ question_text: `Question ${i + 1} about the river?`, options: ["one", "two", "three", "four"], correct_index: 0 })));
const logo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
// A live competition-style campaign with questions and (optionally) readable material.
const live = async (owner: string, over: { title?: string; visibility?: string; reader?: boolean; closes?: string; start?: string | null; brand?: object; category?: string; format?: string } = {}) => {
  await as(owner);
  const c = await rpc("select public.challenge_create($1,'a summary','general_knowledge',$2,3,300,3,$3,null,null,$4,$5)", [over.title ?? "River Quiz", over.visibility ?? "PUBLIC", over.start ?? null, over.visibility === "PRIVATE" ? "CODE12" : null, over.format ?? "CHALLENGE"]);
  await rpc("select public.challenge_set_questions($1,$2)", [c.id, qs()]);
  if (over.reader) { await addDoc(c.id); await rpc("select public.challenge_set_reader($1,true,$2)", [c.id, over.closes ?? "END"]); }
  if (over.brand) await rpc("select public.challenge_set_brand($1,$2)", [c.id, JSON.stringify(over.brand)]);
  await rpc("select public.challenge_publish($1)", [c.id]);
  return c;
};
const firstSection = async (slug: string) => (await rpc("select public.challenge_material($1)", [slug])).documents[0].sections[0].id;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, full_name text, email text);
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, managed_by uuid);
    create table public.user_capabilities(user_id uuid not null, capability text not null constraint user_capabilities_capability_check check (capability in ('super_admin')), active boolean not null default true);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb);
    create table public.questions(id uuid primary key default gen_random_uuid(), subject_code text, grade text, question_text text, option_a text, option_b text, option_c text, option_d text, correct_answer text, explanation text, status text default 'active', answer_type text default 'SINGLE_CHOICE');
    create table public.notifications(id uuid primary key default gen_random_uuid(), recipient_user_id uuid, recipient_profile_id uuid, recipient_email text, recipient_role text not null, type text not null, title text not null, message text not null,
      entity_type text, entity_id uuid, created_at timestamptz not null default now(), read_at timestamptz, market_id uuid, link text check (link is null or link ~ '^/[A-Za-z0-9/_\\-?=&.]*$'), category text not null default 'system' check (category in ('reward','system','payment')));
    create table public.institutions(id uuid primary key, name text);
    create table public.institution_memberships(institution_id uuid, user_id uuid, role text, status text);
    create table public.classes(id uuid primary key, class_name text, status text default 'active', teacher_user_id uuid, institution_id uuid);
    create table public.class_memberships(class_id uuid, student_user_id uuid, status text default 'active');
    create table public.assessments(id uuid primary key default gen_random_uuid(), owner_user_id uuid, reference_type text);
    create table public.qb_access_settings(key text primary key, value jsonb not null);
    create table public.learner_subscriptions(user_id uuid, status text default 'active', valid_from timestamptz default now(), valid_until timestamptz);
    create function public.qb_access_free_limit() returns integer language sql stable as $$ select case when jsonb_typeof(value)='number' then (value #>> '{}')::integer end from public.qb_access_settings where key='free_practice_sessions' $$;
    create function public.qb_has_subscription(p_user uuid) returns boolean language sql stable as $$ select exists(select 1 from public.learner_subscriptions s where s.user_id=p_user and s.status='active' and s.valid_until>now()) $$;
    insert into public.profiles values ('${OWNER}','OWNER','active','Site Owner','o@example.com'),('${TEACHER}','TEACHER','active','Efua Mensah','t@example.com'),('${SPONSOR}','SPONSOR','active','Bank Sponsor','s@example.com'),
      ('${LEARNER}','STUDENT','active','Kofi Boateng','k@example.com'),('${CLASSMATE}','STUDENT','active','Ama Owusu','a@example.com'),('${OUTSIDER}','STUDENT','active','Yaw Mensah','y@example.com'),('${CHILD}','STUDENT','active','Little One',null);
    insert into public.student_profiles(user_id, managed_by) values ('${LEARNER}',null),('${CLASSMATE}',null),('${OUTSIDER}',null),('${CHILD}','${TEACHER}');
    insert into public.classes values ('${CLASS}','JHS 2A','active','${TEACHER}',null);
    insert into public.class_memberships values ('${CLASS}','${CLASSMATE}','active');
  `);
  for (const sql of CHAIN) await db.exec(sql);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("quiz studio", () => {
  it("re-applies cleanly", async () => { await db.exec(MIGRATION); });

  it("classifies material, finds chapters and keeps their order; bad types, bad chapters and a sixth document are refused", async () => {
    await as(SPONSOR);
    const c = await rpc("select public.challenge_create('Faith Quiz','x','general_knowledge','PUBLIC',3,300,1)");
    const added = await addDoc(c.id, "faith_book");
    expect(added).toMatchObject({ ok: true, version: 1, chunks: 6, sections: 2 }); expect(added.words).toBeGreaterThan(40);
    const list = await rpc("select public.challenge_content_list($1)", [c.id]);
    expect(list[0]).toMatchObject({ content_type: "faith_book", title: "The River Story" });
    expect(list[0].sections.map((s: any) => [s.title, s.visible])).toEqual([["Chapter 1: The River", true], ["Chapter 2: The Harvest", true]]);
    await fails("select public.challenge_content_add($1,'x doc','book','a.txt','',$2,true,null,'poetry',null)", [c.id, JSON.stringify(chunks())], /INVALID_CONTENT/);
    await fails("select public.challenge_content_add($1,'x doc','book','a.txt','',$2,true,null,'other',$3)", [c.id, JSON.stringify(chunks()), JSON.stringify([{ title: "A", first: 1, last: 4 }, { title: "B", first: 3, last: 6 }])], /INVALID_CONTENT/);   // overlap
    await fails("select public.challenge_content_add($1,'x doc','book','a.txt','',$2,true,null,'other',$3)", [c.id, JSON.stringify(chunks()), JSON.stringify([{ title: "A", first: 1, last: 9 }])], /INVALID_CONTENT/);               // past the end
    expect((await addDoc(c.id, "other", null)).sections).toBe(1);                                                        // no chapters sent: one section
    for (let i = 0; i < 3; i++) await rpc("select public.challenge_content_add($1,$2,'article','a.txt','',$3,true,null,'article',null)", [c.id, `Doc ${i}`, JSON.stringify(chunks())]);
    await fails("select public.challenge_content_add($1,'Sixth','article','a.txt','',$2,true,null,'article',null)", [c.id, JSON.stringify(chunks())], /RATE_LIMITED/);
    await as(OUTSIDER); await fails("select public.challenge_content_list($1)", [c.id], /NOT_AUTHORIZED/);
  });

  it("reader switches: needs a readable chapter, 'closes when it opens' needs an opening time, targeting is limited to known levels", async () => {
    await as(TEACHER);
    const c = await rpc("select public.challenge_create('Switches','x','general_knowledge','PUBLIC',3,300,1)");
    await fails("select public.challenge_set_reader($1,true,'END')", [c.id], /NO_READABLE_SECTIONS/);
    const doc = await addDoc(c.id);
    await fails("select public.challenge_set_reader($1,true,'START')", [c.id], /READER_NEEDS_OPENING_TIME/);
    await fails("select public.challenge_set_reader($1,true,'SOMETIME')", [c.id], /INVALID_READER/);
    await rpc("select public.challenge_sections_set_visible($1,'{}')", [c.id]);
    await fails("select public.challenge_set_reader($1,true,'END')", [c.id], /NO_READABLE_SECTIONS/);                  // every chapter hidden
    const ids = (await rpc("select public.challenge_content_list($1)", [c.id]))[0].sections.map((s: any) => s.id);
    await rpc("select public.challenge_sections_set_visible($1,$2)", [c.id, [ids[1]]]);
    await rpc("select public.challenge_set_reader($1,true,'END')", [c.id]);
    expect((await rpc("select public.challenge_content_list($1)", [c.id]))[0].sections.map((s: any) => s.visible)).toEqual([false, true]);
    expect(await rpc("select public.challenge_set_targeting($1,'{primary,SHS,shs}')", [c.id])).toMatchObject({ levels: ["PRIMARY", "SHS"] });
    await fails("select public.challenge_set_targeting($1,'{PRIMARY,UNIVERSITY}')", [c.id], /INVALID_TARGET/);
    expect(doc.sections).toBe(2);
  });

  it("joining needs an account in the audience and the right code; it is repeatable; a learner's first join uses the free allowance", async () => {
    const pub = await live(TEACHER, { title: "Open Quiz" });
    const priv = await live(TEACHER, { title: "Coded Quiz", visibility: "PRIVATE" });
    await as(null); await fails("select public.challenge_join($1)", [pub.slug], /permission denied/);
    await as(CHILD); await fails("select public.challenge_join($1)", [pub.slug], /NOT_AUTHORIZED/);
    await as(LEARNER);
    expect(await rpc("select public.challenge_join($1)", [pub.slug])).toEqual({ ok: true, already: false });
    expect(await rpc("select public.challenge_join($1)", [pub.slug])).toEqual({ ok: true, already: true });
    await fails("select public.challenge_join($1,'WRONG')", [priv.slug], /WRONG_CODE/);
    expect((await rpc("select public.challenge_join($1,'CODE12')", [priv.slug])).ok).toBe(true);
    await sup("insert into public.qb_access_settings values ('free_practice_sessions','2'::jsonb)");
    await as(LEARNER); expect(await rpc("select public.qb_my_access()")).toMatchObject({ used: 2, exhausted: true });
    const third = await live(TEACHER, { title: "Third Quiz" });
    await as(LEARNER); await fails("select public.challenge_join($1)", [third.slug], /QB_FREE_ALLOWANCE_EXHAUSTED/);
    await as(CLASSMATE); expect((await rpc("select public.challenge_join($1)", [third.slug])).ok).toBe(true);        // untouched: another learner still has sessions
    await sup("delete from public.qb_access_settings");
    await as(TEACHER); await sup("update public.challenge_campaigns set status = 'PAUSED' where slug = $1", [third.slug]);
    await as(OUTSIDER); await fails("select public.challenge_join($1)", [third.slug], /CHALLENGE_NOT_LIVE/);
  });

  it("the reader opens only for people who joined, is closed during a round and after the end, and only shows chapters the organiser chose", async () => {
    const c = await live(TEACHER, { title: "Reading Quiz", reader: true });
    await as(OUTSIDER);
    expect((await rpc("select public.challenge_material($1)", [c.slug])).state).toBe("NOT_JOINED");
    await db.query("select public.challenge_join($1)", [c.slug]);
    const m = await rpc("select public.challenge_material($1)", [c.slug]);
    expect(m.state).toBe("OPEN"); expect(m.documents[0]).toMatchObject({ title: "The River Story", content_type: "story_book" }); expect(m.documents[0].sections).toHaveLength(2);
    const read = await rpc("select public.challenge_material_read($1,$2)", [c.slug, m.documents[0].sections[0].id]);
    expect(read).toMatchObject({ title: "Chapter 1: The River", no: 1, reader: "Yaw M.", prev: null }); expect(read.passages).toHaveLength(3); expect(read.next).toBe(m.documents[0].sections[1].id);
    // a timed round is running: closed
    const a = await rpc("select public.challenge_start($1)", [c.slug]);
    expect((await rpc("select public.challenge_material($1)", [c.slug])).state).toBe("CLOSED_ROUND");
    await fails("select public.challenge_material_read($1,$2)", [c.slug, m.documents[0].sections[0].id], /READER_CLOSED/);
    await rpc("select public.challenge_submit($1,'[]')", [a.attempt_id]);
    expect((await rpc("select public.challenge_material($1)", [c.slug])).state).toBe("OPEN");
    // someone not in the audience is told so; a hidden chapter is not readable
    await as(TEACHER); const list = await rpc("select public.challenge_content_list($1)", [c.id]);
    await rpc("select public.challenge_sections_set_visible($1,$2)", [c.id, [list[0].sections[0].id]]);
    await as(OUTSIDER); await fails("select public.challenge_material_read($1,$2)", [c.slug, list[0].sections[1].id], /NOT_FOUND/);
    expect((await rpc("select public.challenge_material($1)", [c.slug])).documents[0].sections).toHaveLength(1);
    // the owner can always preview, including hidden chapters
    await as(TEACHER); expect((await rpc("select public.challenge_material_read($1,$2)", [c.slug, list[0].sections[1].id])).no).toBe(2);
    // the end closes it
    await sup("update public.challenge_campaigns set ends_at = now() - interval '1 minute' where id = $1", [c.id]);
    await as(OUTSIDER); expect((await rpc("select public.challenge_material($1)", [c.slug])).state).toBe("CLOSED_ENDED");
    await as(TEACHER); expect((await rpc("select public.challenge_material($1)", [c.slug])).state).toBe("OPEN");
  });

  it("'closes when it opens' ends reading at the opening time; an organiser who has not enabled the reader shows nothing; reads are rate limited", async () => {
    await as(TEACHER);
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const c = await live(TEACHER, { title: "Early Study", reader: true, closes: "START", start: soon });
    const plain = await live(TEACHER, { title: "No Reader" });
    await as(LEARNER); await db.query("select public.challenge_join($1)", [c.slug]); await db.query("select public.challenge_join($1)", [plain.slug]);
    expect((await rpc("select public.challenge_material($1)", [c.slug])).state).toBe("OPEN");
    expect((await rpc("select public.challenge_material($1)", [plain.slug])).state).toBe("NOT_ENABLED");
    await sup("update public.challenge_campaigns set starts_at = now() - interval '1 minute' where id = $1", [c.id]);
    await as(LEARNER); expect((await rpc("select public.challenge_material($1)", [c.slug])).state).toBe("CLOSED_STARTED");
    await sup("update public.challenge_campaigns set starts_at = null, reader_closes = 'END' where id = $1", [c.id]);
    await as(LEARNER); const sec = await firstSection(c.slug);
    await sup("insert into public.challenge_reads(user_id, campaign_id, section_id) select $1, $2, $3 from generate_series(1, 300)", [LEARNER, c.id, sec]);
    await as(LEARNER); await fails("select public.challenge_material_read($1,$2)", [c.slug, sec], /RATE_LIMITED/);
  });

  it("a copy keeps the questions, rounds, prizes, look and material (with its citations) but not the audience or dates, and a private copy gets its own code", async () => {
    await as(TEACHER);
    const c = await rpc("select public.challenge_create('Spelling Cup','x','general_knowledge','PRIVATE',3,300,1,null,null,null,'OLDCODE','COMPETITION')");
    await rpc("select public.challenge_set_stages($1,$2)", [c.id, JSON.stringify([{ title: "Qualifier", question_count: 3, time_limit_seconds: 300, pass_percent: 50, advance_top_n: 5, ends_at: new Date(Date.now() + 3_600_000).toISOString() }, { title: "Final", question_count: 3, time_limit_seconds: 300, pass_percent: 0 }])]);
    await addDoc(c.id); const ch = (await rpc("select public.challenge_content_chunks($1,$2)", [c.id, (await rpc("select public.challenge_content_list($1)", [c.id]))[0].versions[0].version_id]))[0];
    const cited = qs(3), parsed = JSON.parse(cited); parsed[0].source_chunk_id = ch.id; parsed[0].source_quote = "the river and the harvest"; parsed[1].stage_no = 2; parsed[2].stage_no = 2; parsed.push({ ...parsed[1], question_text: "Another final question here?" }, { ...parsed[1], question_text: "And one more final question?" });
    await rpc("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify(parsed.map((q: any, i: number) => (i === 0 ? { ...q, stage_no: 1 } : { ...q, stage_no: i < 3 ? 1 : 2 })))]);
    await rpc("select public.challenge_set_prizes($1,$2)", [c.id, JSON.stringify([{ rank_from: 1, rank_to: 1, kind: "certificate", title: "Gold certificate" }])]);
    await rpc("select public.challenge_set_brand($1,$2)", [c.id, JSON.stringify({ organiser_name: "Accra Academy", accent: "#1a7f5a", logo })]);
    await rpc("select public.challenge_set_reader($1,true,'END')", [c.id]);
    await rpc("select public.challenge_set_audience($1,$2,null)", [c.id, CLASS]);
    const copy = await rpc("select public.challenge_clone($1,'Spelling Cup, term 2')", [c.id]);
    const got = await rpc("select public.challenge_creator_get($1)", [copy.id]);
    expect(got.campaign).toMatchObject({ title: "Spelling Cup, term 2", status: "DRAFT", format: "COMPETITION", cloned_from: c.id, audience_class_id: null, audience_institution_id: null, starts_at: null, ends_at: null, reader_enabled: true, stage_count: 2 });
    expect(got.campaign.access_code).toMatch(/^[0-9A-F]{6}$/); expect(got.campaign.access_code).not.toBe("OLDCODE");
    expect(got.campaign.brand).toMatchObject({ organiser_name: "Accra Academy", accent: "#1a7f5a" });
    expect(got.stages.map((s: any) => [s.title, s.advance_top_n, s.ends_at])).toEqual([["Qualifier", null, null], ["Final", null, null]]);                    // closing times belong to the old run
    expect(got.prizes).toHaveLength(1); expect(got.questions).toHaveLength(5);
    const cites = got.questions.filter((q: any) => q.source_chunk_id); expect(cites).toHaveLength(1); expect(cites[0].source_chunk_id).not.toBe(ch.id); expect(cites[0].source_quote).toBe("the river and the harvest");
    const lst = await rpc("select public.challenge_content_list($1)", [copy.id]);
    expect(lst[0]).toMatchObject({ content_type: "story_book", current_version: 1 }); expect(lst[0].sections).toHaveLength(2);
    expect((await rpc("select public.challenge_my_campaigns()")).some((r: any) => r.id === copy.id && r.cloned_from === c.id)).toBe(true);
    await as(OUTSIDER); await fails("select public.challenge_clone($1)", [c.id], /NOT_AUTHORIZED/);
  });

  it("logos must be small PNG, JPEG or WebP pictures; the sponsored feed shows only branded, public, sponsor-made campaigns that match the viewer's level; library counts leave out drafts and private ones", async () => {
    await as(SPONSOR);
    const draftCamp = await rpc("select public.challenge_create('Logo Test','x','sponsor','PUBLIC',3,300,1)");
    await fails("select public.challenge_set_brand($1,$2)", [draftCamp.id, JSON.stringify({ logo: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" })], /INVALID_BRAND/);
    await fails("select public.challenge_set_brand($1,$2)", [draftCamp.id, JSON.stringify({ logo: "https://evil.example/x.png" })], /INVALID_BRAND/);
    await fails("select public.challenge_set_brand($1,$2)", [draftCamp.id, JSON.stringify({ logo: `data:image/png;base64,${"A".repeat(45_100)}` })], /INVALID_BRAND/);
    const branded = await live(SPONSOR, { title: "Bank Product Quiz", category: "sponsor", brand: { organiser_name: "Bank", logo } });
    await rpc("select public.challenge_set_targeting($1,'{JHS}')", [branded.id]);
    const noLogo = await live(SPONSOR, { title: "Plain Sponsor Quiz" });
    const learnerMade = await live(LEARNER, { title: "Learner Branded", brand: { organiser_name: "Kofi", logo } });
    await as(LEARNER);
    const jhs = await rpc("select public.challenge_featured(8,'JHS')"), shs = await rpc("select public.challenge_featured(8,'SHS')"), all = await rpc("select public.challenge_featured(8,null)");
    expect(jhs.map((x: any) => x.slug)).toEqual([branded.slug]); expect(shs).toEqual([]); expect(all.map((x: any) => x.slug)).toEqual([branded.slug]);
    expect(jhs[0].brand.logo).toMatch(/^data:image\/png/); expect([noLogo.slug, learnerMade.slug].some((s) => all.some((x: any) => x.slug === s))).toBe(false);
    await as("service");
    const stats = await rpc("select public.challenge_library_stats()");
    expect(stats.documents).toBeGreaterThan(0); expect(Object.keys(stats.by_type).every((k) => ["story_book", "faith_book", "doctrine", "corporate", "marketing", "textbook", "article", "other"].includes(k))).toBe(true);
    const before = stats.documents;
    await as(SPONSOR); const priv = await live(SPONSOR, { title: "Private Material", visibility: "PRIVATE", reader: true });
    await as("service"); expect((await rpc("select public.challenge_library_stats()")).documents).toBe(before);       // private campaigns are not counted
    await as(null); await fails("select public.challenge_library_stats()", [], /permission denied/);
    expect(priv.id).toBeTruthy();
  });

  it("the public card carries material facts but never text; the rollback removes the new functions", async () => {
    await as("service");
    const slug = (await sup("select slug from public.challenge_campaigns where reader_enabled and visibility = 'PUBLIC' and status = 'LIVE' limit 1"))[0].slug;
    await as("service"); const card = await rpc("select public.challenge_public_get($1)", [slug]);
    expect(card.material).toMatchObject({ closes: "END", documents: 1 }); expect(JSON.stringify(card)).not.toMatch(/Passage number/);
    await db.exec("reset role"); await db.exec(ROLLBACK);
    expect(await rpc("select count(*)::int from pg_proc where proname in ('challenge_material','challenge_join','challenge_clone','challenge_featured','challenge_library_stats')")).toBe(0);
    expect(await rpc("select to_regclass('public.challenge_sections') is null")).toBe(true);
  });
});
