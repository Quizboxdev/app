import { gradeKey, keyOf, standardCode, type VerifiedIndicator } from "./verified";

// Turns verified indicator rows into the curriculum_nodes hierarchy the platform already uses:
// education_level > grade > subject > strand > sub_strand > content_standard > learning_indicator.
// Identity keys follow the existing convention (20261001190000/200000): education_level|canonical grade|subject|node_type|code.
// Pure code: the database step is the qb_curriculum_nodes_import function (20261012110000), which takes this list in order.
export type NodeType = "education_level" | "grade" | "subject" | "strand" | "sub_strand" | "content_standard" | "learning_indicator";
export type StructureNode = {
  node_type: NodeType; code: string; title: string; source_terminology: string; education_level: string;
  grade_code: string | null; source_grade_code: string | null; canonical_grade_code: string | null; subject_code: string | null;
  sort_order: number; identity_key: string; parent_key: string | null; metadata: Record<string, unknown>;
};
export type StructurePlan = { nodes: StructureNode[]; counts: Record<NodeType, number>; collisions: string[]; problems: string[] };

const slug = (s: string) => keyOf(s).replace(/ /g, "-").slice(0, 60) || "x";
// Canonical grade as stored today: JHS grades keep their form (B7), SHS years are SHS1..SHS3 with the printed label kept as the source grade.
export function canonicalGrade(grade: string): string {
  const g = gradeKey(grade);
  return /^shs[123]$/.test(g) ? g.toUpperCase() : grade.trim().toUpperCase().replace(/\s+/g, "");
}
// "1.1.1.CS.1" and "1.1.1.CS2" are the first and second content standards of a sub-strand (the printed forms vary).
const csStandard = (code: string) => standardCode(code).replace(/\.CS\.?(\d)/i, ".CS$1");
function shortHash(text: string): string {
  let h = 2166136261;
  for (const ch of keyOf(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(36).padStart(6, "0").slice(0, 6);
}
const identity = (n: { education_level: string; canonical_grade_code: string | null; subject_code: string | null; node_type: string; code: string }) =>
  [n.education_level || "GLOBAL", n.canonical_grade_code || "GLOBAL", n.subject_code || "GLOBAL", n.node_type, n.code].join("|");

export function buildStructure(rows: VerifiedIndicator[], opts: { sourceFile: string }): StructurePlan {
  const nodes = new Map<string, StructureNode>(), problems: string[] = [], collisions: string[] = [];
  let order = 0;
  // Never drop a node silently: if two different texts want the same identity, the later one gets a short hash of its own text.
  const put = (n: Omit<StructureNode, "identity_key" | "sort_order">): string => {
    let node = n, key = identity(node);
    const existing = nodes.get(key);
    if (existing && existing.title !== node.title && node.node_type !== "education_level" && node.node_type !== "grade" && node.node_type !== "subject") {
      node = { ...n, code: `${n.code}~${shortHash(n.title)}` }; key = identity(node);
      collisions.push(`${n.node_type} ${n.code} (same code, different text)`);
    }
    if (!nodes.has(key)) nodes.set(key, { ...node, identity_key: key, sort_order: order++ });
    return key;
  };

  // Codes repeat inside one grade and subject: SHS "1.1.1.LI.1" appears once under each content standard ("1.1.1.CS.1", "1.1.1.CS2") of a
  // sub-strand. A suffix on every member keeps identity keys unique and the order of the source.
  const scope = (r: VerifiedIndicator) => `${r.level}|${canonicalGrade(r.grade)}|${keyOf(r.subject)}`;
  const indicatorGroups = new Map<string, Set<string>>(), standardGroups = new Map<string, Set<string>>();
  const place = (r: VerifiedIndicator) => `${r.strand_no}.${slug(r.sub_strand)}.${csStandard(r.content_standard_code) || slug(r.content_standard)}`;
  for (const r of rows) {
    const ik = `${scope(r)}|${standardCode(r.indicator_code)}`, ck = `${scope(r)}|${csStandard(r.content_standard_code)}`;
    (indicatorGroups.get(ik) ?? indicatorGroups.set(ik, new Set()).get(ik)!).add(`${place(r)}|${keyOf(r.indicator)}`);
    (standardGroups.get(ck) ?? standardGroups.set(ck, new Set()).get(ck)!).add(place(r));
  }

  for (const r of rows) {
    if (!r.subject || !r.grade || !r.indicator_code || !r.indicator) { problems.push(`MISSING_FIELDS:${r.subject}|${r.grade}|${r.indicator_code}`); continue; }
    const level = r.level === "SHS" ? "SHS" : r.level === "JHS" ? "JHS" : "";
    if (!level) { problems.push(`UNKNOWN_LEVEL:${r.grade}`); continue; }
    const grade = canonicalGrade(r.grade), base = { education_level: level };
    const lvlKey = put({ ...base, node_type: "education_level", code: `LEVEL:${level}`, title: level === "JHS" ? "Junior High School" : "Senior High School", source_terminology: "Education Level",
      grade_code: null, source_grade_code: null, canonical_grade_code: null, subject_code: null, parent_key: null, metadata: { structure_only: true } });
    const gradeKeyNode = put({ ...base, node_type: "grade", code: `GRADE:${grade}`, title: r.grade, source_terminology: "Grade / Form", grade_code: grade, source_grade_code: r.grade,
      canonical_grade_code: grade, subject_code: null, parent_key: lvlKey, metadata: { structure_only: true } });
    const subjKey = put({ ...base, node_type: "subject", code: `SUBJECT:${grade}:${slug(r.subject)}`, title: r.subject, source_terminology: "Subject", grade_code: grade, source_grade_code: r.grade,
      canonical_grade_code: grade, subject_code: r.subject, parent_key: gradeKeyNode, metadata: { structure_only: true } });
    const common = { ...base, grade_code: grade, source_grade_code: r.grade, canonical_grade_code: grade, subject_code: r.subject };
    const strandKey = put({ ...common, node_type: "strand", code: `STRAND:${r.strand_no || slug(r.strand)}`, title: r.strand || `Strand ${r.strand_no}`, source_terminology: "Strand", parent_key: subjKey, metadata: {} });
    const subKey = put({ ...common, node_type: "sub_strand", code: `SUBSTRAND:${r.strand_no}:${slug(r.sub_strand)}`, title: r.sub_strand || "Sub-strand", source_terminology: "Sub-strand", parent_key: strandKey, metadata: {} });

    const csCode = csStandard(r.content_standard_code) || standardCode(r.indicator_code).split(".").slice(0, -1).join(".");
    const csClash = (standardGroups.get(`${scope(r)}|${csStandard(r.content_standard_code)}`)?.size ?? 1) > 1;
    const csUnique = csClash ? `${csCode}@${place(r)}` : csCode;
    if (csClash) collisions.push(`content_standard ${scope(r)} ${csCode}`);
    const csKey = put({ ...common, node_type: "content_standard", code: csUnique, title: r.content_standard || csCode, source_terminology: "Content Standard", parent_key: subKey,
      metadata: { printed_code: r.content_standard_code } });

    const code = standardCode(r.indicator_code);
    const clash = (indicatorGroups.get(`${scope(r)}|${code}`)?.size ?? 1) > 1;
    const unique = clash ? `${code}@${place(r)}` : code;
    if (clash) collisions.push(`indicator ${scope(r)} ${code}`);
    put({ ...common, node_type: "learning_indicator", code: unique, title: r.indicator, source_terminology: "Learning Indicator", parent_key: csKey,
      metadata: { printed_code: r.indicator_code, standard_code: code, exemplars: r.exemplars, page: r.page, wording_verified: r.wording_verified, flags: r.flags, source_file: opts.sourceFile } });
  }

  const list = [...nodes.values()];
  const counts = { education_level: 0, grade: 0, subject: 0, strand: 0, sub_strand: 0, content_standard: 0, learning_indicator: 0 } as Record<NodeType, number>;
  list.forEach((n) => { counts[n.node_type]++; });
  return { nodes: list, counts, collisions: [...new Set(collisions)], problems };
}

// Chunks the list for the import function while keeping every parent before its children.
export function chunkNodes(nodes: StructureNode[], size = 400): StructureNode[][] {
  const out: StructureNode[][] = [];
  for (let i = 0; i < nodes.length; i += size) out.push(nodes.slice(i, i + size));
  return out;
}
