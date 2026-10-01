import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { NormalizedCurriculumNode } from "../lib/content/types";

export const canonicalKey = (node: NormalizedCurriculumNode) => [
  node.curriculumCode,
  node.educationLevel ?? "GLOBAL",
  node.canonicalGradeCode ?? node.grade ?? "GLOBAL",
  node.subject ?? "GLOBAL",
  node.nodeType,
  node.code,
].join("|");

export const databaseIdentity = (node: NormalizedCurriculumNode) => [
  node.educationLevel ?? "GLOBAL",
  node.canonicalGradeCode ?? node.grade ?? "GLOBAL",
  node.subject ?? "GLOBAL",
  node.nodeType,
  node.code,
].join("|");

function expectedParentType(node: NormalizedCurriculumNode) {
  if (node.nodeType === "grade") return "education_level";
  if (node.nodeType === "subject") return "grade";
  if (node.nodeType === "strand" || node.nodeType === "topic") return "subject";
  if (node.nodeType === "sub_strand" || node.nodeType === "subtopic") return node.code.split(".").length > 2 ? "strand" : "subject";
  if (node.nodeType === "content_standard") return node.code.split(".").length > 3 ? "sub_strand" : "subject";
  if (node.nodeType === "learning_indicator" || node.nodeType === "learning_objective") return "content_standard";
  return undefined;
}

export function expectedParentKey(node: NormalizedCurriculumNode) {
  if (!node.parentCode) return undefined;
  const parentType = expectedParentType(node);
  if (!parentType) return undefined;
  const globalParent = parentType === "education_level";
  const gradeParent = parentType === "grade";
  return [
    node.curriculumCode,
    globalParent ? node.educationLevel ?? "GLOBAL" : node.educationLevel ?? "GLOBAL",
    globalParent ? "GLOBAL" : gradeParent ? node.grade ?? "GLOBAL" : node.grade ?? "GLOBAL",
    ["education_level", "grade"].includes(parentType) ? "GLOBAL" : node.subject ?? "GLOBAL",
    parentType,
    node.parentCode,
  ].join("|");
}

export function validateGraph(nodes: NormalizedCurriculumNode[]) {
  const byKey = new Map<string, NormalizedCurriculumNode[]>();
  for (const node of nodes) {
    const key = canonicalKey(node);
    byKey.set(key, [...(byKey.get(key) ?? []), node]);
  }
  const collisions = [...byKey].filter(([, rows]) => rows.length > 1).map(([key, rows]) => ({ canonicalKey: key, count: rows.length, sources: [...new Set(rows.map((row) => row.sourceFile))] }));
  const unresolved = nodes.flatMap((node) => {
    const parentKey = expectedParentKey(node);
    if (!parentKey || byKey.has(parentKey)) return [];
    return [{
      canonicalKey: canonicalKey(node), nodeType: node.nodeType, code: node.code, title: node.title,
      curriculum: node.curriculumCode, educationLevel: node.educationLevel, grade: node.grade,
      sourceGradeCode: node.sourceGradeCode, canonicalGradeCode: node.canonicalGradeCode,
      subject: node.subject, expectedParentKey: parentKey, parentCode: node.parentCode,
      parentType: expectedParentType(node), sourceFile: node.sourceFile,
      reason: "No normalized parent candidate has the expected canonical identity",
    }];
  });
  const invalidParentTypes = nodes.flatMap((node) => {
    const parentKey = expectedParentKey(node);
    const parent = parentKey ? byKey.get(parentKey)?.[0] : undefined;
    return parent && parent.nodeType !== expectedParentType(node) ? [{ child: canonicalKey(node), parent: canonicalKey(parent) }] : [];
  });
  const parents = new Map(nodes.map((node) => [canonicalKey(node), expectedParentKey(node)]));
  const cycles: string[][] = [];
  for (const node of nodes) {
    const trail: string[] = [];
    let cursor: string | undefined = canonicalKey(node);
    while (cursor) {
      if (trail.includes(cursor)) { cycles.push([...trail.slice(trail.indexOf(cursor)), cursor]); break; }
      trail.push(cursor); cursor = parents.get(cursor);
    }
  }
  return { unresolved, collisions, invalidParentTypes, cycles };
}

async function main() {
  const reportDirectory = path.join(process.cwd(), "reports");
  const nodes = JSON.parse(await readFile(path.join(reportDirectory, "curriculum-nodes.json"), "utf8")) as NormalizedCurriculumNode[];
  const result = validateGraph(nodes);
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(path.join(reportDirectory, "unresolved-curriculum-parents.json"), JSON.stringify({ generatedAt: new Date().toISOString(), totalNodes: nodes.length, ...result }, null, 2));
  console.log(JSON.stringify({ totalNodes: nodes.length, unresolved: result.unresolved.length, collisions: result.collisions.length, invalidParentTypes: result.invalidParentTypes.length, cycles: result.cycles.length }, null, 2));
  if (result.collisions.length || result.invalidParentTypes.length || result.cycles.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : "Validation failed"); process.exitCode = 1; });
}
