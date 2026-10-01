import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { auditQuestions, discoverSources, extractCurriculumNodes, extractPdfQuestions, extractStructuredQuestions, extractText } from "../lib/content/pipeline";

async function main() {
  const sourceRoot = path.resolve(process.argv[2] ?? path.join(process.cwd(), "..", "Curriculum"));
  const reportDirectory = path.join(process.cwd(), "reports");
  const sources = await discoverSources(sourceRoot);
  const curriculumNodes = [];
  const questions = [];
  const parseErrors: Array<{ file: string; error: string }> = [];

  for (const source of sources) {
    if (source.parseability !== "supported") continue;
    try {
      let text: string | undefined;
      if (source.contentType === "curriculum" || source.contentType === "mixed") {
        text = await extractText(source);
        curriculumNodes.push(...extractCurriculumNodes(source, text));
      }
      if ([".csv", ".xlsx", ".xls", ".json"].includes(source.extension)) {
        questions.push(...await extractStructuredQuestions(source));
      }
      if (source.extension === ".pdf" && ["questions", "mixed", "marking_scheme"].includes(source.contentType)) {
        text ??= await extractText(source);
        questions.push(...extractPdfQuestions(source, text));
      }
    } catch (error) {
      parseErrors.push({ file: source.relativePath, error: error instanceof Error ? error.message : "Unknown parse error" });
    }
  }

  const dedupedNodes = [...new Map(curriculumNodes.map((node) => [`${node.curriculumCode}:${node.subject}:${node.code}`, node])).values()];
  const audited = auditQuestions(questions);
  const summary = {
  generatedAt: new Date().toISOString(),
  sourceRoot,
  totalSourceFiles: sources.length,
  curricula: [...new Set(dedupedNodes.map((node) => node.curriculumName))].sort(),
  educationLevels: [...new Set(sources.map((source) => source.educationLevel).filter(Boolean))].sort(),
  grades: [...new Set(sources.flatMap((source) => source.grades))].sort(),
  subjects: [...new Set(sources.map((source) => source.subject).filter(Boolean))].sort(),
  normalizedCurriculumNodes: dedupedNodes.length,
  questionRecordsDiscovered: questions.length,
  validQuestions: audited.filter((row) => row.classification === "valid").length,
  warnings: audited.filter((row) => row.classification === "warning").length,
  rejected: audited.filter((row) => row.classification === "rejected").length,
  duplicates: audited.filter((row) => row.issues.some((issue) => issue.code === "DUPLICATE_QUESTION")).length,
  successfullyPrepared: audited.filter((row) => row.classification !== "rejected").length,
  parseErrors: parseErrors.length,
  };

  await mkdir(reportDirectory, { recursive: true });
  await writeFile(path.join(reportDirectory, "content-inventory.json"), JSON.stringify({ summary, sources }, null, 2));
  await writeFile(path.join(reportDirectory, "curriculum-nodes.json"), JSON.stringify(dedupedNodes, null, 2));
  await writeFile(path.join(reportDirectory, "question-audit.json"), JSON.stringify({ summary, questions: audited, parseErrors }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Content audit failed");
  process.exitCode = 1;
});
