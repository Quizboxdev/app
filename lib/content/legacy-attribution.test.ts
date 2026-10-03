import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeliveryFixture } from "../competition/fixtures/database";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
const q = { governed: randomUUID(), ungoverned: randomUUID(), foreign: randomUUID(), ambiguous: randomUUID(), sponsor: randomUUID() };

async function allowed(question: string, user = id(4)) {
  await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  return (await db.query<{ ok: boolean }>("select quizbox_market.question_allowed($1) ok", [question])).rows[0].ok;
}
async function question(questionId: string, node: string | null) {
  await db.query(`insert into questions(id,subject_code,subject_name,grade,question_text,option_a,option_b,option_c,option_d,correct_answer,curriculum_node_id,validation_status)
    values($1,'Science','Science','B10','Legacy question','A','B','C','D','A',$2,'approved')`, [questionId, node]);
}

describe("legacy node attribution over the isolated governance SQL", () => {
  beforeAll(async () => {
    ({ db } = await createDeliveryFixture());
    await db.exec("reset role; alter table questions disable trigger user");
    const ghana = (await db.query<{ id: string }>("select id from markets where name='Ghana'")).rows[0].id;
    const authority = (await db.query<{ id: string }>("select id from curriculum_authorities where market_id=$1 limit 1", [ghana])).rows[0].id;
    await db.exec(`insert into currencies values('NGN','Naira','N',2,true);
      insert into countries(iso2_code,iso3_code,name,default_currency_code,timezone,locale) values('NG','NGA','Nigeria','NGN','Africa/Lagos','en-NG');
      insert into markets(country_id,name,default_currency_code,timezone,locale) select id,'Nigeria','NGN',timezone,locale from countries where iso2_code='NG';`);
    const nigeria = (await db.query<{ id: string }>("select id from markets where name='Nigeria'")).rows[0].id;
    const ngAuthority = (await db.query<{ id: string }>("insert into curriculum_authorities(market_id,code,name) values($1,'NERDC','Nigeria authority') returning id", [nigeria])).rows[0].id;
    const curricula = { governed: randomUUID(), ungoverned: randomUUID(), foreign: randomUUID() };
    await db.query("insert into curricula(id,code,country,market_id) values($1,'GH-GOV','Ghana',$4),($2,'GH-UNGOV','Ghana',$4),($3,'NG-GOV','Nigeria',$5)", [curricula.governed, curricula.ungoverned, curricula.foreign, ghana, nigeria]);
    await db.query("insert into market_curricula(curriculum_id,market_id,authority_id,active) values($1,$4,$6,true),($2,$4,null,true),($3,$5,$7,true)", [curricula.governed, curricula.ungoverned, curricula.foreign, ghana, nigeria, authority, ngAuthority]);
    const nodes = { governed: randomUUID(), ungoverned: randomUUID(), foreign: randomUUID() };
    for (const key of ["governed", "ungoverned", "foreign"] as const)
      await db.query("insert into curriculum_nodes(id,curriculum_id,education_level,is_active,source_grade_code,canonical_grade_code,subject_code,grade_code) values($1,$2,'SHS',true,'B10','SHS1','Science','B10')", [nodes[key], curricula[key]]);
    await question(q.governed, nodes.governed); await question(q.ungoverned, nodes.ungoverned);
    await question(q.foreign, nodes.foreign); await question(q.ambiguous, null);
    await db.exec("alter table questions enable trigger user; select quizbox_market.attribute_legacy_by_node();");
  }, 120_000);
  afterAll(async () => { await db?.close(); });

  it("attributes node-governed legacy questions to their own node curriculum and market only", async () => {
    const rows = (await db.query<{ question_id: string; market: string }>("select l.question_id,m.name market from legacy_content_attributions l join markets m on m.id=l.market_id where question_id=any($1::uuid[])", [Object.values(q)])).rows;
    expect(Object.fromEntries(rows.map(r => [r.question_id, r.market]))).toEqual({ [q.governed]: "Ghana", [q.foreign]: "Nigeria" });
  });
  it("serves governed Ghana legacy content to a Ghana member", async () => expect(await allowed(q.governed)).toBe(true));
  it("keeps content from a curriculum without a recorded authority denied", async () => expect(await allowed(q.ungoverned)).toBe(false));
  it("keeps another market's content denied to a Ghana member", async () => {
    expect(await allowed(q.foreign)).toBe(false);
  });
  it("queues ambiguous content for manual review instead of attributing it", async () => {
    const issues = (await db.query<{ record_id: string; reason: string }>("select record_id,reason from market_attribution_issues where entity='question' and record_id=any($1::uuid[]) order by reason", [[q.ungoverned, q.foreign, q.ambiguous, q.governed]])).rows;
    expect(issues.map(i => i.record_id).sort()).toEqual([q.ungoverned, q.ambiguous].sort());
    expect(issues.find(i => i.record_id === q.ambiguous)?.reason).toBe("No curriculum or node provenance; manual review required");
    expect(await allowed(q.ambiguous)).toBe(false);
  });
  it("is idempotent and not callable by API roles", async () => {
    await db.exec("reset role");
    expect((await db.query<{ n: number }>("select quizbox_market.attribute_legacy_by_node() n")).rows[0].n).toBe(0);
    await db.exec("set role authenticated");
    await expect(db.query("select quizbox_market.attribute_legacy_by_node()")).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });
});

describe("legacy node attribution reversal", () => {
  it("restores the original predicate and reapplies cleanly", async () => {
    const { db: fresh } = await createDeliveryFixture();
    const sql = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    const body = async () => (await fresh.query<{ b: string }>("select pg_get_functiondef('quizbox_competition.curriculum_question_allowed(uuid,jsonb)'::regprocedure) b")).rows[0].b;
    await fresh.exec(sql("../../supabase/rollback/competition_review_operations.sql"));
    await fresh.exec(sql("../../supabase/rollback/legacy_node_attribution.sql"));
    expect(await body()).not.toContain("coalesce(q.curriculum_id");
    await fresh.exec(sql("../../supabase/migrations/20261002260000_legacy_node_attribution.sql"));
    await fresh.exec(sql("../../supabase/migrations/20261002270000_competition_review_operations.sql"));
    expect(await body()).toContain("coalesce(q.curriculum_id");
    await fresh.close();
  }, 120_000);
});
