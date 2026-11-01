import { checkRows, normaliseRow, toImportRows, type Report } from "./check";
import { keyOf, resolveIndicator, type CurriculumIndex, type Resolution, type VerifiedIndicator } from "../curriculum/verified";
import { TOPIC_BLOCK_SIZE, type LoadRow } from "./template";

// The loading plan: everything the engine decides about a checked question file before anything is written.
// It places each question on a verified curriculum indicator, derives the topics and concepts to register, and says exactly what
// could not be placed. Pure code: the database step (tracker L4/L5) only executes the plan.
export type PlannedTopic = {
  key: string; title: string; indicator: Pick<VerifiedIndicator, "subject" | "grade" | "indicator_code" | "strand" | "sub_strand" | "content_standard_code" | "indicator" | "node_id">;
  concepts: string[]; rows: number; easy: number; medium: number; hard: number; fileRows: number[];
};
export type RowPlacement = { fileRow: number; resolution: Resolution["status"]; topicKey: string | null; concept: string };
export type LoadPlan = {
  fileSha256: string; scope: "CURRICULUM" | "SPONSOR"; report: Report; topics: PlannedTopic[]; placements: RowPlacement[];
  unresolved: Array<{ fileRow: number; status: string; subject: string; grade: string; indicator_code: string; candidates: string[] }>;
  importRows: ReturnType<typeof toImportRows>; canLoad: boolean; blockers: string[];
};

// Chooses the commonest spelling of a name so the registry gets one consistent title even if a batch drifted.
function commonest(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
}

// The topic registry accepts titles of 3 to 160 characters (qb_question_load, QB_TOPIC_INVALID_TITLE). A curriculum indicator can be much longer, and a topic's title
// is that indicator's sentence, so a long title is cut at a word boundary and ends with an ellipsis. The full wording stays on the curriculum indicator itself, and the
// topic's identity key is built from the full text, so shortening never merges two topics.
export const TOPIC_TITLE_MAX = 160;
export const CONCEPT_NAME_MAX = 120;
function shortenAtWord(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1), at = cut.lastIndexOf(" ");
  return (at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:.\-–]+$/, "") + "…";
}
export const registryTitle = (title: string): string => shortenAtWord(title, TOPIC_TITLE_MAX);
// A concept name must be 2 to 120 characters, and the database reports a longer one with the same "needs 1 to 12 concepts" message as a bad count.
// Questions are linked to their concept by name, so the shortened name is used both in the topic's concept list and on every question row.
export const registryConcept = (concept: string): string => shortenAtWord(concept, CONCEPT_NAME_MAX);


// fileSha256 is computed by the caller (node:crypto on the command line, crypto.subtle in the browser) so this module runs in both.
export function buildPlan(input: { rows: LoadRow[]; fileRows?: number[]; fileSha256: string; scope: "CURRICULUM" | "SPONSOR"; index?: CurriculumIndex; topicBlock?: number }): LoadPlan {
  const fileRows = input.fileRows ?? input.rows.map((_, i) => i + 2);
  const rows = input.rows.map(normaliseRow);
  const report = checkRows(rows, input.scope, fileRows, { topicBlock: input.topicBlock ?? TOPIC_BLOCK_SIZE });
  const blockers: string[] = [];
  if (!report.canLoad) blockers.push("QL_CHECK_FAILED");

  const levelMismatch: number[] = [], placements: RowPlacement[] = [], unresolved: LoadPlan["unresolved"] = [], groups = new Map<string, { rows: LoadRow[]; fileRows: number[]; indicator: VerifiedIndicator | null }>();
  rows.forEach((r, i) => {
    let indicator: VerifiedIndicator | null = null, status: RowPlacement["resolution"] = "RESOLVED";
    if (input.scope === "CURRICULUM") {
      if (!input.index) { status = "UNKNOWN_INDICATOR"; }
      else {
        const res = resolveIndicator(input.index, r);
        status = res.status;
        if (res.status === "RESOLVED") { indicator = res.indicator; if (indicator.level !== "OTHER" && r.level && r.level.toUpperCase() !== indicator.level.toUpperCase()) levelMismatch.push(fileRows[i]); }
        else unresolved.push({ fileRow: fileRows[i], status: res.status, subject: r.subject, grade: r.grade, indicator_code: r.indicator_code, candidates: res.candidates.slice(0, 4).map((c) => `${c.strand} / ${c.sub_strand}`) });
      }
      if (!input.index) unresolved.push({ fileRow: fileRows[i], status, subject: r.subject, grade: r.grade, indicator_code: r.indicator_code, candidates: [] });
    }
    // A topic belongs to one indicator; sponsor topics belong to the document's chapter and section.
    const owner = input.scope === "CURRICULUM" ? (indicator ? `${indicator.subject}|${indicator.grade}|${indicator.strand_no}|${keyOf(indicator.sub_strand)}|${indicator.indicator_code}` : null) : `${keyOf(r.strand)}|${keyOf(r.sub_strand)}`;
    const key = owner && r.topic ? `${owner}|${keyOf(r.topic)}` : null;
    if (key) { const g = groups.get(key) ?? { rows: [], fileRows: [], indicator }; g.rows.push(r); g.fileRows.push(fileRows[i]); groups.set(key, g); }
    placements.push({ fileRow: fileRows[i], resolution: status, topicKey: key, concept: r.concept });
  });

  const topics: PlannedTopic[] = [...groups.entries()].map(([key, g]) => {
    const concepts: string[] = [], seen = new Set<string>();
    for (const r of g.rows) { const c = registryConcept(r.concept ?? ""); if (c && !seen.has(keyOf(c))) { seen.add(keyOf(c)); concepts.push(c); } }
    const ind = g.indicator;
    return { key, title: registryTitle(commonest(g.rows.map((r) => r.topic))), concepts, rows: g.rows.length,
      easy: g.rows.filter((r) => r.difficulty === "easy").length, medium: g.rows.filter((r) => r.difficulty === "medium").length, hard: g.rows.filter((r) => r.difficulty === "hard").length, fileRows: g.fileRows,
      indicator: ind ? { subject: ind.subject, grade: ind.grade, indicator_code: ind.indicator_code, strand: ind.strand, sub_strand: ind.sub_strand, content_standard_code: ind.content_standard_code, indicator: ind.indicator, node_id: ind.node_id }
        : { subject: rows[0]?.subject ?? "", grade: "", indicator_code: "", strand: "", sub_strand: "", content_standard_code: "", indicator: "" } };
  });

  if (unresolved.length) blockers.push(`QL_UNRESOLVED_INDICATORS:${unresolved.length}`);
  // The level column is a label; the indicator code decides. A PRIMARY row that resolves to a JHS indicator (or the reverse) is refused, not loaded under the wrong level.
  if (levelMismatch.length) blockers.push(`QL_LEVEL_MISMATCH:${levelMismatch.length}`);
  const noConcept = topics.filter((t) => t.concepts.length === 0);
  if (noConcept.length) blockers.push(`QL_TOPIC_WITHOUT_CONCEPTS:${noConcept.length}`);
  const tooMany = topics.filter((t) => t.concepts.length > 12);
  if (tooMany.length) blockers.push(`QL_TOPIC_TOO_MANY_CONCEPTS:${tooMany.length}`);

  return { fileSha256: input.fileSha256, scope: input.scope, report, topics, placements, unresolved,
    importRows: toImportRows(rows), canLoad: blockers.length === 0, blockers };
}

// Plain-language summary for the admin screen and the command line.
export function describePlan(plan: LoadPlan): string[] {
  const lines = [`${plan.report.rows} questions in ${plan.topics.length} topics (${plan.topics.filter((t) => t.rows === TOPIC_BLOCK_SIZE).length} complete blocks of ${TOPIC_BLOCK_SIZE})`];
  if (plan.unresolved.length) {
    const byStatus = new Map<string, number>();
    plan.unresolved.forEach((u) => byStatus.set(u.status, (byStatus.get(u.status) ?? 0) + 1));
    lines.push(`Could not place ${plan.unresolved.length} questions on the curriculum: ${[...byStatus].map(([s, n]) => `${n} ${s.toLowerCase().replaceAll("_", " ")}`).join(", ")}`);
  }
  lines.push(plan.canLoad ? "Ready to load." : `Blocked: ${plan.blockers.join(", ")}`);
  return lines;
}
