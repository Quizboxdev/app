"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { getQuestionAvailability, listCurriculumNodes } from "@/lib/api/curriculum";
import { levelDisplayName, looksLikeCode, niceTitle, topicsInsteadOfStrands } from "@/lib/curriculum/display";

export type CurriculumBrowserNode = { id: string; node_type: string; code: string | null; title: string; source_terminology: string | null; subject_code: string | null; grade_code: string | null };
// A topic reached by skipping its strand: the strand is kept as `via` so the question filters stay exact, but it is never shown.
type Listed = CurriculumBrowserNode & { via?: CurriculumBrowserNode };

// Plain level names come from lib/curriculum/display (no strand / indicator jargon, no codes).
const LEAF = new Set(["learning_indicator", "learning_objective"]);
export const nodeLevelName = (node: CurriculumBrowserNode) => levelDisplayName(node.node_type, node.source_terminology);

// Curriculum path → the question columns that carry each level (questions are denormalised with strand/sub-strand/standard/indicator).
export function curriculumScopeFilters(path: Pick<CurriculumBrowserNode, "node_type" | "code" | "title" | "subject_code" | "grade_code">[]) {
  const out: { grade?: string; subject?: string; strand?: string; substrand?: string; standard?: string; indicator?: string } = {};
  for (const node of path) {
    if (node.node_type === "grade" && node.grade_code) out.grade = node.grade_code;
    if (node.subject_code) out.subject = node.subject_code;
    if (node.node_type === "strand") out.strand = node.title;
    if (node.node_type === "sub_strand") out.substrand = node.title;
    if (node.node_type === "content_standard" && node.code) out.standard = node.code;
    if (node.node_type === "learning_indicator" && node.code) out.indicator = node.code;
  }
  return out;
}

// Shared curriculum drill-down over curriculum_nodes (Learn, Question Bank, Assignment Builder). `root` starts the walk inside a node
// (e.g. a class's subject). A node is a leaf at indicator/objective level or when it has no children; `renderLeaf` shows it.
export default function CurriculumBrowser({ curriculumId, root = null, onPathChange, renderLeaf, rootLabel = "All levels" }: {
  curriculumId: string;
  root?: CurriculumBrowserNode | null;
  onPathChange?: (path: CurriculumBrowserNode[]) => void;
  renderLeaf?: (leaf: CurriculumBrowserNode, ctx: { path: CurriculumBrowserNode[]; available: number }) => ReactNode;
  rootLabel?: string;
}) {
  const [path, setPath] = useState<CurriculumBrowserNode[]>([]);
  const [children, setChildren] = useState<Listed[]>([]);
  const [available, setAvailable] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const rootId = root?.id ?? null;
  useEffect(() => { setPath([]); }, [curriculumId, rootId]);
  useEffect(() => { onPathChange?.(path); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = path[path.length - 1] ?? root;
  useEffect(() => {
    if (!curriculumId) return;
    let active = true;
    setLoading(true);
    listCurriculumNodes({ curriculumId, parentId: current ? current.id : null })
      .then(async (rows) => {
        let nodes = rows as Listed[];
        // Teachers choose topics, not strands: where a level is made of strands, list the topics (sub-strands) inside them directly.
        if (nodes.some((n) => n.node_type === "strand")) {
          const lists = await Promise.all(nodes.map((n) => (n.node_type === "strand" ? listCurriculumNodes({ curriculumId, parentId: n.id }).catch(() => []) : Promise.resolve([]))));
          const inside = new Map(nodes.map((n, i) => [n.id, lists[i] as Listed[]]));
          nodes = topicsInsteadOfStrands(nodes, (strand) => inside.get(strand.id) ?? []);
        }
        const counts = await getQuestionAvailability(nodes.concat(current ? [current] : []).map((n) => n.id)).catch(() => []);
        if (!active) return;
        setChildren(nodes);
        setAvailable(Object.fromEntries((counts as any[]).map((row) => [row.curriculum_node_id, Number(row.approved_count)])));
        setError("");
      })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [curriculumId, current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const leaf = current && (LEAF.has(current.node_type) || (!loading && children.length === 0)) ? current : null;

  return (
    <div aria-live="polite">
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      <ol className="qb-crumbs" aria-label="Curriculum path">
        <li><button type="button" className="qb-link" onClick={() => setPath([])}>{root?.title ?? rootLabel}</button></li>
        {path.map((node, i) => node.node_type === "strand" && i < path.length - 1 ? null
          : <li key={node.id}>{i === path.length - 1 ? <strong aria-current="page">{niceTitle(node.title)}</strong> : <button type="button" className="qb-link" onClick={() => setPath(path.slice(0, i + 1))}>{niceTitle(node.title)}</button>}</li>)}
      </ol>
      {leaf && renderLeaf ? renderLeaf(leaf, { path, available: available[leaf.id] ?? 0 })
        : loading ? <div className="qb-node-grid" aria-busy="true">{[1, 2, 3].map((i) => <div key={i} className="qb-node qb-skeleton" />)}</div>
        : children.length ? <div className="qb-node-grid">
          {children.map((node) => <button type="button" key={node.id} className="qb-node" onClick={() => setPath([...path, ...(node.via ? [node.via] : []), node])}>
            <span><strong>{looksLikeCode(node.title) ? nodeLevelName(node) : niceTitle(node.title)}</strong>{nodeLevelName(node)}{available[node.id] ? ` · ${available[node.id]} question${available[node.id] === 1 ? "" : "s"}` : ""}</span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>)}
        </div>
        : <div className="qb-empty"><strong>No curriculum available</strong>Nothing is published below this level yet.</div>}
    </div>
  );
}
