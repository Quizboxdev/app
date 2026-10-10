import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactoryFixture, fixtureId as id } from "../content/factory/fixture";

// qb_question_load against the real governed import (approved sources, active curriculum, answer and provenance validation, review state).
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
let db: PGlite, market: string, curriculum: string, source: string, ind: string[];
async function as(user: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
let serial = 0;
const row = (topic_key: string, node: string, concept: string, over: Record<string, unknown> = {}) => ({
  topic_key, concept, indicator_node_id: node, subject: "Computing", grade: "B7",
  question_text: `Which part of a computer is described in situation number ${++serial} that a learner meets at school?`,
  answer_type: "SINGLE_CHOICE", option_a: `Memory unit ${serial}`, option_b: `Display unit ${serial}`, option_c: `Input device ${serial}`, option_d: `Power supply ${serial}`,
  correct_answer: "C", explanation: `The input device sends information into the computer; the other parts store, show or power it (${serial}).`,
  difficulty: "easy", cognitive_level: "Understand", source_reference: "NaCCA Computing B7 p.12", ...over });
const topics = () => [
  { key: "t-hw", indicator_node_id: ind[0], title: "Parts of a computer", concepts: ["input devices", "output devices", "storage"] },
  { key: "t-sw", indicator_node_id: ind[1], title: "Types of software", concepts: ["system software", "application software"] },
];
const load = async (over: Record<string, unknown>) => (await db.query<{ v: any }>("select public.qb_question_load($1::jsonb) v", [JSON.stringify({
  scope: "CURRICULUM", market_id: market, curriculum_id: curriculum, source_document_ids: [source], topics: topics(), ...over })])).rows[0].v;

beforeAll(async () => {
  const f = await createFactoryFixture();
  ({ db, market, curriculum, source, ind } = f);
  await db.exec("reset role");
  await db.exec(read("../../supabase/migrations/20261012100000_topic_registry.sql"));
  await db.exec(read("../../supabase/migrations/20261012120000_question_load.sql"));
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("qb_question_load", () => {
  it("records the file, registers topics and concepts, imports into review and links every question", async () => {
    await as(id(13));
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => row("t-hw", ind[0], ["input devices", "output devices", "storage"][i % 3])),
      ...Array.from({ length: 3 }, (_, i) => row("t-sw", ind[1], ["system software", "application software"][i % 2])),
    ];
    const r = await load({ file_name: "computing-b7.csv", file_sha256: sha("file-1"), rows });
    expect(r).toMatchObject({ status: "LOADED", rows_total: 7, rows_loaded: 7, rows_rejected: 0, linked: 7 });
    await db.exec("reset role");
    const topicsOut = (await db.query<{ title: string; n: string; c: string }>(
      "select t.title, count(l.question_id)::text n, count(distinct l.concept_id)::text c from curriculum_topics t left join question_topic_links l on l.topic_id = t.id group by t.title order by t.title")).rows;
    expect(topicsOut).toEqual([{ title: "Parts of a computer", n: "4", c: "3" }, { title: "Types of software", n: "3", c: "2" }]);
    const states = (await db.query<{ validation_status: string; status: string; n: string }>(
      "select q.validation_status, q.status, count(*)::text n from question_topic_links l join questions q on q.id = l.question_id group by 1, 2")).rows;
    expect(states).toEqual([{ validation_status: "review", status: "inactive", n: "7" }]);
    const batch = (await db.query<{ status: string; rows_loaded: number }>("select status, rows_loaded from question_load_batches")).rows;
    expect(batch).toEqual([{ status: "LOADED", rows_loaded: 7 }]);
  });

  it("refuses the same file twice, non-admins, unknown topics and malformed requests", async () => {
    await as(id(13));
    const rows = [row("t-hw", ind[0], "storage")];
    await expect(load({ file_name: "computing-b7.csv", file_sha256: sha("file-1"), rows })).rejects.toThrow("QB_LOAD_FILE_ALREADY_LOADED");
    await expect(load({ file_name: "x.csv", file_sha256: "short", rows })).rejects.toThrow("QB_LOAD_FILE_HASH_REQUIRED");
    await expect(load({ file_name: "x.csv", file_sha256: sha("f2"), rows: [row("nope", ind[0], "storage")] })).rejects.toThrow("QB_LOAD_UNKNOWN_TOPIC:nope");
    await expect(load({ file_name: "x.csv", file_sha256: sha("f3"), rows: [] })).rejects.toThrow("QB_LOAD_INVALID_BATCH");
    await as(id(10));
    await expect(load({ file_name: "y.csv", file_sha256: sha("f4"), rows })).rejects.toThrow("QB_LOAD_ACCESS_DENIED");
    await as(null);
    await expect(load({ file_name: "y.csv", file_sha256: sha("f5"), rows })).rejects.toThrow();
  });

  it("loads what is valid, reports what is rejected, and ends PARTIAL", async () => {
    await as(id(13));
    const bad = row("t-hw", ind[0], "storage", { indicator_node_id: randomUUID() });
    const r = await load({ file_name: "partial.csv", file_sha256: sha("partial"), rows: [row("t-hw", ind[0], "storage"), bad, row("t-sw", ind[1], "system software")] });
    expect(r).toMatchObject({ status: "PARTIAL", rows_total: 3, rows_loaded: 2, rows_rejected: 1 });
    expect(r.import.row_errors).toEqual([expect.objectContaining({ row: 2, code: "QB_IMPORT_UNKNOWN_INDICATOR" })]);
  });

  it("accepts a file in several calls, keeping row positions and counts across them", async () => {
    await as(id(13));
    const first = await load({ file_name: "big.csv", file_sha256: sha("big"), expected_rows: 4, rows: [row("t-hw", ind[0], "input devices"), row("t-hw", ind[0], "output devices")] });
    expect(first).toMatchObject({ status: "LOADING", rows_total: 2, rows_loaded: 2 });
    const second = await load({ batch_id: first.batch_id, rows: [row("t-sw", ind[1], "application software"), row("t-sw", ind[1], "system software")] });
    expect(second).toMatchObject({ batch_id: first.batch_id, status: "LOADED", rows_total: 4, rows_loaded: 4 });
    await db.exec("reset role");
    const byConcept = (await db.query<{ title: string; n: string }>(
      `select c.title, count(*)::text n from question_topic_links l join topic_concepts c on c.id = l.concept_id
        join questions q on q.id = l.question_id where q.tags::text like '%' || $1 || '%' group by c.title order by c.title`, [first.batch_id])).rows;
    expect(byConcept).toEqual([{ title: "application software", n: "1" }, { title: "input devices", n: "1" }, { title: "output devices", n: "1" }, { title: "system software", n: "1" }]);
    await expect(load({ batch_id: first.batch_id, rows: [row("t-hw", ind[0], "storage")] })).rejects.toThrow("QB_LOAD_BATCH_CLOSED");
    await as(id(10));
    await expect(load({ batch_id: first.batch_id, rows: [row("t-hw", ind[0], "storage")] })).rejects.toThrow();
  });
});
