import { describe, expect, it } from "vitest";
import { buildIndex, parseVerifiedCsv } from "../curriculum/verified";
import { buildPlan, CONCEPT_NAME_MAX, registryConcept } from "./plan";
import { buildLoadPayload, chunkPayload } from "./payload";
import type { LoadRow } from "./template";

const HEADER = "subject,grade,strand_no,strand,sub_strand,content_standard_code,content_standard,indicator_code,indicator,exemplars,page,wording_verified,flags";
const NODE_A = "11111111-1111-4111-8111-111111111111", NODE_B = "22222222-2222-4222-8222-222222222222";
const CSV = [HEADER,
  `"Science","B7","4","FORCES AND ENERGY","ENERGY","B7.4.1.1","Forms of energy","B7.4.1.1.1","Identify the various forms of energy","","26","YES",""`,
  `"Science","B7","4","FORCES AND ENERGY","ENERGY","B7.4.1.1","Forms of energy","B7.4.1.1.2","Explain daily applications of forms of energy","","27","YES",""`,
].join("\r\n");
// The database loader (lib/api/question-loading.ts) sets node_id from the loaded curriculum node; do the same here.
const index = buildIndex(parseVerifiedCsv(CSV).map((r, i) => ({ ...r, node_id: [NODE_A, NODE_B][i] })));

// Varied wording on purpose: the checker rejects batches whose stems or explanations all start the same way.
const OPENERS = ["Which", "What", "Identify the", "Name the", "Select the", "Choose the", "Find the", "Decide which", "Pick the", "State the"];
const ITEMS = ["torch", "battery", "radio", "kettle", "bicycle", "candle", "fan", "solar panel", "drum", "match", "iron", "bell", "lamp", "stove", "kite", "pump", "mill", "cooker", "phone", "wire"];
const UNIQUE = (i: number) => `${ITEMS[i % ITEMS.length]}${Math.floor(i / ITEMS.length) || ""}`;
const row = (i: number, over: Partial<LoadRow> = {}): LoadRow => ({
  level: "JHS", grade: "B7", subject: "Science", strand: "FORCES AND ENERGY", sub_strand: "ENERGY", indicator_code: "B7.4.1.1.1", topic: "Forms of energy",
  concept: ["energy forms", "energy sources", "energy chains"][i % 3], difficulty: i % 50 < 15 ? "easy" : i % 50 < 35 ? "medium" : "hard", cognitive_level: "Remember", answer_type: "SINGLE_CHOICE",
  question_text: `${OPENERS[i % OPENERS.length]} form of energy a ${UNIQUE(i)} gives off when a learner uses it in situation ${i}?`,
  option_a: "Chemical energy", option_b: "Sound energy", option_c: "Kinetic energy", option_d: "Light energy", correct_answer: "ABCD"[i % 4],
  explanation: `${["Because", "Since", "As", "Given that", "When"][i % 5]} the ${UNIQUE(i)} works the way it does in situation ${i}, its main output decides the form of energy that learners should name.`,
  source_reference: "NaCCA Science B7 p.26", source_quote: "", ...over });

const build = (rows: LoadRow[]) => buildPlan({ rows, fileSha256: "a".repeat(64), scope: "CURRICULUM", index });

describe("load payload", () => {
  it("carries the placed indicator, subject and grade, and one topic entry per topic", () => {
    const rows = [...Array.from({ length: 20 }, (_, i) => row(i)), ...Array.from({ length: 10 }, (_, i) => row(100 + i, { indicator_code: "B7.4.1.1.2", topic: "Daily uses of energy", concept: "home uses" }))];
    const plan = build(rows), payload = buildLoadPayload(plan, rows);
    expect(payload.rows).toHaveLength(30);
    expect(payload.expectedRows).toBe(30);
    expect(payload.skipped).toEqual([]);
    expect(payload.topics.map((t) => t.indicator_node_id)).toEqual([NODE_A, NODE_B]);
    expect(payload.topics[0]).toMatchObject({ title: "Forms of energy", concepts: ["energy forms", "energy sources", "energy chains"], target_questions: 50 });
    expect(payload.rows[0]).toMatchObject({ indicator_node_id: NODE_A, subject: "Science", grade: "B7", difficulty: "easy" });
    expect(payload.rows[25].indicator_node_id).toBe(NODE_B);
  });

  it("appends the verbatim source quote to the reference and keeps it within 200 characters", () => {
    const rows = [row(0, { source_quote: "Energy exists in many forms such as chemical, light and sound." }), row(1, { source_quote: "x".repeat(190) })];
    const payload = buildLoadPayload(build(rows), rows);
    expect(payload.rows[0].source_reference).toBe("NaCCA Science B7 p.26 | Energy exists in many forms such as chemical, light and sound.");
    expect(payload.rows[1].source_reference).toHaveLength(200);
  });

  it("refuses a plan that cannot load", () => {
    const rows = [row(0, { indicator_code: "B7.9.9.9.9" })];
    const plan = build(rows);
    expect(plan.canLoad).toBe(false);
    expect(() => buildLoadPayload(plan, rows)).toThrow("QL_PLAN_BLOCKED");
  });

  it("splits into calls of at most the chunk size, each with only its own topics", () => {
    // 130 rows over 3 topics; a chunk size of 50 stands in for the 500-row limit of one database call.
    const rows = Array.from({ length: 130 }, (_, i) => row(i, { topic: `Topic ${Math.floor(i / 50)}` }));
    const payload = buildLoadPayload(build(rows), rows);
    const calls = chunkPayload(payload, 50);
    expect(calls.map((c) => c.rows.length)).toEqual([50, 50, 30]);
    expect(calls.flatMap((c) => c.rows)).toEqual(payload.rows);
    for (const c of calls) {
      const used = new Set(c.rows.map((r) => r.topic_key));
      expect(new Set(c.topics.map((t) => t.key))).toEqual(used);
    }
  });
});

describe("concept names for the registry", () => {
  const LONG = "Ancient vs modern communication and tools: talking drums, smoke signals, runners, and stone implements vs telecommunications and metal machinery";
  it("keeps a name of 120 characters or fewer exactly as written, and cuts a longer one at a word boundary", () => {
    expect(registryConcept("energy forms")).toBe("energy forms");
    const short = registryConcept(LONG);
    expect(LONG.length).toBeGreaterThan(CONCEPT_NAME_MAX);
    expect(short.length).toBeLessThanOrEqual(CONCEPT_NAME_MAX);
    expect(short.endsWith("…")).toBe(true);
    expect(LONG.startsWith(short.slice(0, -1))).toBe(true);
  });
  it("uses the same shortened name in the topic's concept list and on every question, so the server can link them", () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(i, { concept: i % 2 ? LONG : "energy forms" }));
    const payload = buildLoadPayload(build(rows), rows);
    expect(payload.topics[0].concepts.every((c) => c.length >= 2 && c.length <= CONCEPT_NAME_MAX)).toBe(true);
    for (const r of payload.rows) expect(payload.topics[0].concepts).toContain(r.concept);
    expect(payload.topics[0].concepts).toHaveLength(2);
  });
  it("does not turn two different long names that share a long start into extra concepts beyond the limit", () => {
    const base = "A very long concept name that keeps going and going so that its first one hundred and twenty characters are identical for both";
    const rows = [...Array.from({ length: 10 }, (_, i) => row(i, { concept: `${base} alpha` })), ...Array.from({ length: 10 }, (_, i) => row(10 + i, { concept: `${base} beta` }))];
    const payload = buildLoadPayload(build(rows), rows);
    expect(payload.topics[0].concepts).toHaveLength(1);
    for (const r of payload.rows) expect(payload.topics[0].concepts).toContain(r.concept);
  });
});
