import { normaliseRow } from "./check";
import { registryConcept, type LoadPlan } from "./plan";
import type { LoadRow } from "./template";

// What qb_question_load receives (20261012120000): the topics to register and the rows to import, at most 500 rows per call.
// Subject and grade are taken from the placed indicator (the import checks them against the curriculum node), never from the file.
export type LoadTopic = { key: string; indicator_node_id: string; title: string; concepts: string[]; target_questions: number };
export type LoadRowPayload = {
  topic_key: string; concept: string; indicator_node_id: string; subject: string; grade: string; question_text: string; answer_type: string;
  option_a: string; option_b: string; option_c: string; option_d: string; correct_answer: string; explanation: string;
  difficulty: string; cognitive_level: string; source_reference: string;
};
export type LoadPayload = { topics: LoadTopic[]; rows: LoadRowPayload[]; expectedRows: number; skipped: number[] };

export function buildLoadPayload(plan: LoadPlan, input: LoadRow[], topicBlock = 50): LoadPayload {
  if (!plan.canLoad) throw new Error("QL_PLAN_BLOCKED");
  const rows = input.map(normaliseRow);
  const byKey = new Map(plan.topics.map((t) => [t.key, t]));
  const topics: LoadTopic[] = [], seen = new Set<string>(), out: LoadRowPayload[] = [], skipped: number[] = [];
  rows.forEach((r, i) => {
    const placement = plan.placements[i], topic = placement?.topicKey ? byKey.get(placement.topicKey) : undefined;
    const nodeId = topic?.indicator.node_id;
    if (!placement || !topic || !nodeId) { skipped.push(placement?.fileRow ?? i + 1); return; }
    if (!seen.has(topic.key)) {
      seen.add(topic.key);
      topics.push({ key: topic.key, indicator_node_id: nodeId, title: topic.title, concepts: topic.concepts, target_questions: topicBlockOf(topicBlock) });
    }
    out.push({ topic_key: topic.key, concept: registryConcept(r.concept), indicator_node_id: nodeId, subject: topic.indicator.subject, grade: topic.indicator.grade,
      question_text: r.question_text, answer_type: r.answer_type, option_a: r.option_a, option_b: r.option_b, option_c: r.option_c, option_d: r.option_d,
      correct_answer: r.correct_answer, explanation: r.explanation, difficulty: r.difficulty, cognitive_level: r.cognitive_level,
      source_reference: (r.source_quote ? `${r.source_reference} | ${r.source_quote}` : r.source_reference).slice(0, 200) });
  });
  return { topics, rows: out, expectedRows: out.length, skipped };
}
const topicBlockOf = (n: number) => Math.min(500, Math.max(1, Math.round(n)));

// Splits a payload into calls of at most `size` rows; every call carries only the topics its rows use.
export function chunkPayload(payload: LoadPayload, size = 500): Array<{ topics: LoadTopic[]; rows: LoadRowPayload[] }> {
  const calls: Array<{ topics: LoadTopic[]; rows: LoadRowPayload[] }> = [];
  for (let i = 0; i < payload.rows.length; i += size) {
    const rows = payload.rows.slice(i, i + size), keys = new Set(rows.map((r) => r.topic_key));
    calls.push({ rows, topics: payload.topics.filter((t) => keys.has(t.key)) });
  }
  return calls;
}
