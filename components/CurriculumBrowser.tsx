"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { getQuestionAvailability, listCurriculumNodes } from "@/lib/api/curriculum";

export type CurriculumBrowserNode = { id: string; node_type: string; code: string | null; title: string; source_terminology: string | null; subject_code: string | null; grade_code: string | null };

// Ghana hierarchy labels; the curriculum's own terminology wins when it supplies one.
const LEVEL: Record<string, string> = {
  education_level: "Education level", grade: "Grade", subject: "Subject", strand: "Strand", sub_strand: "Sub-strand", topic: "Topic", subtopic: "Subtopic",
  content_standard: "Content standard", learning_indicator: "Learning indicator", learning_objective: "Learning objective",
};
const LEAF = new Set(["learning_indicator", "learning_objective"]);
export const nodeLevelName = (node: CurriculumBrowserNode) => node.source_terminology || LEVEL[node.node_type] || node.node_type;

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
  const [children, setChildren] = useState<CurriculumBrowserNode[]>([]);
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
        const nodes = rows as CurriculumBrowserNode[];
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
        {path.map((node, i) => <li key={node.id}>{i === path.length - 1 ? <strong aria-current="page">{node.title}</strong> : <button type="button" className="qb-link" onClick={() => setPath(path.slice(0, i + 1))}>{node.title}</button>}</li>)}
      </ol>
      {leaf && renderLeaf ? renderLeaf(leaf, { path, available: available[leaf.id] ?? 0 })
        : loading ? <div className="qb-node-grid" aria-busy="true">{[1, 2, 3].map((i) => <div key={i} className="qb-node qb-skeleton" />)}</div>
        : children.length ? <div className="qb-node-grid">
          {children.map((node) => <button type="button" key={node.id} className="qb-node" onClick={() => setPath([...path, node])}>
            <span><strong>{node.title}</strong>{nodeLevelName(node)}{node.code ? ` · ${node.code}` : ""}{available[node.id] ? ` · ${available[node.id]} questions` : ""}</span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>)}
        </div>
        : <div className="qb-empty"><strong>No curriculum available</strong>Nothing is published below this level yet.</div>}
    </div>
  );
}
