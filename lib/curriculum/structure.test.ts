import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStructure, canonicalGrade, chunkNodes } from "./structure";
import { parseVerifiedCsv } from "./verified";

const HEADER = "subject,grade,strand_no,strand,sub_strand,content_standard_code,content_standard,indicator_code,indicator,exemplars,page,wording_verified,flags";
const csv = (lines: string[]) => [HEADER, ...lines].join("\r\n");
const JHS = csv([
  '"Science","B7","4","FORCES AND ENERGY","ENERGY","B7.4.1.1","Forms of energy","B7.4.1.1.1","Identify the forms of energy","1) list","26","YES",""',
  '"Science","B7","4","FORCES AND ENERGY","ENERGY","B7.4.1.1","Forms of energy","B7.4.1.1.2","Explain daily applications of energy","","27","YES",""',
  '"Creative Arts and Design","B7","1","DESIGN","Design in nature","B7 1.1.1","Design as a concept","B7 1.1.1.1","Demonstrate understanding of design","","2","YES","printed_code_nonstandard"',
]);
const SHS = csv([
  '"Biology","SHS 1","1","Diversity of living things","Classification","1.1.1","Classification","1.1.1.LI.1","Classify living things","","5","YES",""',
  '"Biology","SHS 1","2","Cells","Cell structure","1.1.1","Cell structure","1.1.1.LI.1","Describe the cell","","12","YES",""',
  '"Biology","YEAR ONE","2","Cells","Cell structure","1.1.1","Cell structure","1.1.1.LI.2","Name cell parts","","12","YES",""',
]);

describe("curriculum structure builder", () => {
  it("builds the platform hierarchy with identity keys in the existing format", () => {
    const plan = buildStructure(parseVerifiedCsv(JHS), { sourceFile: "NaCCA JHS" });
    expect(plan.problems).toEqual([]);
    expect(plan.counts).toEqual({ education_level: 1, grade: 1, subject: 2, strand: 2, sub_strand: 2, content_standard: 2, learning_indicator: 3 });
    const ind = plan.nodes.find((n) => n.code === "B7.4.1.1.1")!;
    expect(ind).toMatchObject({ node_type: "learning_indicator", identity_key: "JHS|B7|Science|learning_indicator|B7.4.1.1.1", canonical_grade_code: "B7", subject_code: "Science" });
    expect(ind.metadata).toMatchObject({ exemplars: "1) list", page: "26", source_file: "NaCCA JHS" });
    const nonStandard = plan.nodes.find((n) => n.node_type === "learning_indicator" && n.title.startsWith("Demonstrate understanding of design"))!;
    expect(nonStandard.code).toBe("B7.1.1.1.1");
    expect(nonStandard.metadata).toMatchObject({ printed_code: "B7 1.1.1.1" });
  });

  it("lists every parent before its children and links parents by identity key", () => {
    const plan = buildStructure(parseVerifiedCsv(JHS), { sourceFile: "x" });
    const seen = new Set<string>();
    for (const n of plan.nodes) { if (n.parent_key) expect(seen.has(n.parent_key)).toBe(true); seen.add(n.identity_key); }
    expect(plan.nodes[0].parent_key).toBeNull();
    expect(plan.nodes.map((n) => n.sort_order)).toEqual([...plan.nodes.keys()]);
  });

  it("maps SHS years to SHS1..SHS3 and keeps the printed label, and disambiguates codes that repeat across sub-strands", () => {
    expect(["SHS 1", "Year One", "SHS1", "B10", "B7"].map(canonicalGrade)).toEqual(["SHS1", "SHS1", "SHS1", "SHS1", "B7"]);
    const plan = buildStructure(parseVerifiedCsv(SHS), { sourceFile: "NaCCA SHS" });
    const inds = plan.nodes.filter((n) => n.node_type === "learning_indicator");
    expect(inds).toHaveLength(3);
    expect(new Set(inds.map((n) => n.identity_key)).size).toBe(3);
    expect(inds.filter((n) => n.code.startsWith("1.1.1.LI.1@")).length).toBe(2);
    expect(inds.find((n) => n.code === "1.1.1.LI.2")?.canonical_grade_code).toBe("SHS1");
    expect(inds[0]).toMatchObject({ education_level: "SHS", source_grade_code: "SHS 1" });
    expect(plan.collisions.length).toBeGreaterThan(0);
  });

  it("keeps every indicator when a code repeats under different content standards, and never drops one silently", () => {
    const rows = parseVerifiedCsv(csv([
      '"Additional Mathematics","SHS 1","1","Number","Number and algebraic patterns","1.1.1.CS.1","Binary operations","1.1.1.LI.1","Explain binary operations","","37","YES",""',
      '"Additional Mathematics","SHS 1","1","Number","Number and algebraic patterns","1.1.1.CS2","Surds","1.1.1.LI.1","Investigate the properties of surds","","53","YES",""',
      '"Additional Mathematics","SHS 1","1","Number","Number and algebraic patterns","1.1.1.CS2","Surds","1.1.1.LI.1","A third, differently worded indicator with the same code","","54","YES",""',
    ]));
    const plan = buildStructure(rows, { sourceFile: "x" });
    const inds = plan.nodes.filter((n) => n.node_type === "learning_indicator");
    expect(inds).toHaveLength(3);
    expect(new Set(inds.map((n) => n.identity_key)).size).toBe(3);
    expect(plan.nodes.filter((n) => n.node_type === "content_standard")).toHaveLength(2);
    expect(inds.map((n) => n.title)).toEqual(rows.map((r) => r.indicator));
    // Each indicator hangs under its own content standard.
    const parentOf = (title: string) => plan.nodes.find((n) => n.identity_key === inds.find((i) => i.title === title)!.parent_key)!.title;
    expect(parentOf("Explain binary operations")).toBe("Binary operations");
    expect(parentOf("Investigate the properties of surds")).toBe("Surds");
  });

  it("reports rows it cannot place and chunks large lists", () => {
    const plan = buildStructure(parseVerifiedCsv(csv(['"Science","","4","S","S","B7.4.1","x","B7.4.1.1.1","Something","","1","YES",""'])), { sourceFile: "x" });
    expect(plan.nodes).toEqual([]);
    expect(plan.problems[0]).toContain("MISSING_FIELDS");
    expect(chunkNodes(Array.from({ length: 1000 }, (_, i) => ({ sort_order: i }) as never), 400).map((c) => c.length)).toEqual([400, 400, 200]);
  });
});

// The import function, applied to an isolated PostgreSQL with minimal stand-ins for the tables it touches.
const MIGRATION = readFileSync(new URL("../../supabase/migrations/20261012110000_curriculum_structure_import.sql", import.meta.url), "utf8");
const ROLLBACK = readFileSync(new URL("../../supabase/rollback/curriculum_structure_import.sql", import.meta.url), "utf8");
const SUPER = "00000000-0000-4000-8000-000000000001", OTHER = "00000000-0000-4000-8000-000000000002", CURRICULUM = "00000000-0000-4000-8000-0000000000c1";
let db: PGlite;
async function as(user: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
}
describe("qb_curriculum_nodes_import", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create schema quizbox_market;
      create function quizbox_market.is_super() returns boolean language sql stable as $$ select auth.uid() = '${SUPER}'::uuid $$;
      create table public.curricula (id uuid primary key);
      create table public.curriculum_nodes (id uuid primary key default gen_random_uuid(), curriculum_id uuid not null references public.curricula(id),
        parent_id uuid references public.curriculum_nodes(id), node_type text not null, code text not null, identity_key text not null, title text not null,
        source_terminology text not null, education_level text, grade_code text, source_grade_code text, canonical_grade_code text, subject_code text,
        sort_order integer not null default 0, source_file text, source_version text, metadata jsonb not null default '{}', is_active boolean not null default true,
        unique (curriculum_id, identity_key));
      insert into public.curricula values ('${CURRICULUM}');
      grant usage on schema auth, quizbox_market to authenticated, anon;
      grant execute on all functions in schema auth, quizbox_market to authenticated, anon;
      grant usage on schema public to authenticated, anon;`);
    await db.exec(MIGRATION);
  }, 120_000);
  afterAll(async () => { await db.close(); });

  const importNodes = (nodes: unknown[], curriculum = CURRICULUM) =>
    db.query<{ v: { inserted: number; existing: number } }>("select public.qb_curriculum_nodes_import($1, $2::jsonb, 'NaCCA', '2020') v", [curriculum, JSON.stringify(nodes)]).then((r) => r.rows[0].v);

  it("loads a built structure, links parents, and is idempotent", async () => {
    const plan = buildStructure([...parseVerifiedCsv(JHS), ...parseVerifiedCsv(SHS)], { sourceFile: "NaCCA" });
    await as(SUPER);
    const first = await importNodes(plan.nodes);
    expect(first).toEqual({ inserted: plan.nodes.length, existing: 0 });
    expect(await importNodes(plan.nodes)).toEqual({ inserted: 0, existing: plan.nodes.length });
    await db.exec("reset role");
    const tree = await db.query<{ node_type: string; n: string }>("select node_type, count(*)::text n from public.curriculum_nodes group by node_type order by node_type");
    expect(Object.fromEntries(tree.rows.map((r) => [r.node_type, Number(r.n)]))).toMatchObject({ learning_indicator: 6, education_level: 2 });
    const orphan = await db.query("select count(*)::int c from public.curriculum_nodes where parent_id is null and node_type <> 'education_level'");
    expect(orphan.rows[0]).toEqual({ c: 0 });
    const ind = await db.query<{ parent: string; grade: string }>("select p.node_type parent, c.canonical_grade_code grade from public.curriculum_nodes c join public.curriculum_nodes p on p.id = c.parent_id where c.code = 'B7.4.1.1.1'");
    expect(ind.rows[0]).toEqual({ parent: "content_standard", grade: "B7" });
  });

  it("refuses anyone who is not a super admin, a missing curriculum, a missing parent and bad batches", async () => {
    const node = { node_type: "grade", code: "GRADE:B8", title: "B8", identity_key: "JHS|B8|GLOBAL|grade|GRADE:B8", parent_key: null };
    await as(OTHER);
    await expect(importNodes([node])).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(null);
    await expect(importNodes([node])).rejects.toThrow();
    await as(SUPER);
    await expect(importNodes([node], "00000000-0000-4000-8000-0000000000ff")).rejects.toThrow("CURRICULUM_NOT_FOUND");
    await expect(importNodes([{ ...node, parent_key: "nowhere" }])).rejects.toThrow("QB_NODE_PARENT_MISSING:nowhere");
    await expect(importNodes([{ ...node, node_type: "galaxy" }])).rejects.toThrow("QB_NODE_INVALID_TYPE");
    await expect(importNodes([{ ...node, title: " " }])).rejects.toThrow("QB_NODE_INVALID");
    await expect(importNodes([])).rejects.toThrow("QB_INVALID_BATCH");
  });

  it("rolls back cleanly", async () => {
    await db.exec("reset role");
    await db.exec(ROLLBACK);
    expect((await db.query("select to_regprocedure('public.qb_curriculum_nodes_import(uuid,jsonb,text,text)') f")).rows[0]).toEqual({ f: null });
    await db.exec(MIGRATION);
  });
});

describe("Primary (B4-B6) structure", () => {
  const PRIMARY = csv([
    '"Mathematics","B4","1","NUMBER","Counting","B4.1.1.1","Understand place value","B4.1.1.1.1","Model number quantities","1) model","2","YES",""',
    '"FRENCH","B5","1","IDENTITE","Saluer","B5.1.1.1","Comprehension","B5.1.1.1.1","Ecouter et comprendre","","2","YES",""',
    '"Our World Our People","B6","1","ALL ABOUT US","Myself","B6.1.1.1","Self-awareness","B6.1.1.1.1","Explain how special each individual is","","2","YES",""',
  ]);
  it("keeps the Primary level, grades and subjects on the identity keys of the loaded Primary skeleton", () => {
    const rows = parseVerifiedCsv(PRIMARY);
    expect(rows.map((r) => r.level)).toEqual(["Primary", "Primary", "Primary"]);
    const plan = buildStructure(rows, { sourceFile: "NaCCA Primary" });
    expect(plan.problems).toEqual([]);
    const keys = plan.nodes.map((n) => n.identity_key);
    // these are the keys written by 20261011110000_ghana_primary_curriculum.sql, so the import attaches to them instead of duplicating them
    expect(keys).toContain("Primary|GLOBAL|GLOBAL|education_level|LEVEL:PRIMARY");
    expect(keys).toContain("Primary|B4|GLOBAL|grade|GRADE:B4");
    expect(keys).toContain("Primary|B4|Mathematics|subject|SUBJECT:B4:MATHEMATICS");
    expect(keys).toContain("Primary|B5|FRENCH|subject|SUBJECT:B5:FRENCH");
    expect(keys).toContain("Primary|B6|Our World Our People|subject|SUBJECT:B6:OUR_WORLD_OUR_PEOPLE");
    expect(plan.nodes.find((n) => n.node_type === "education_level")).toMatchObject({ education_level: "Primary", title: "Primary" });
  });
});
