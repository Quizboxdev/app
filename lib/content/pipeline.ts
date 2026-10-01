import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { auditQuestion, educationLevelForGrade, fingerprintQuestion, normalizeGrade, normalizeSubject, normalizeText } from "./normalize";
import type { AuditedQuestion, NormalizedCurriculumNode, NormalizedQuestion, SourceDocument } from "./types";

const supported = new Set([".pdf", ".docx", ".xlsx", ".xls", ".csv", ".json", ".txt"]);

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory() && !["node_modules", ".next", ".git"].includes(entry.name)) return walk(full);
    return entry.isFile() ? [full] : [];
  }));
  return nested.flat();
}

function inferMetadata(file: string) {
  const name = path.basename(file, path.extname(file)).replace(/[_.]+/g, " ");
  const grades = new Set<string>();
  for (const match of name.matchAll(/\bB(?:ASIC)?\s*-?\s*(4|5|6|7|8|9|10)\b/gi)) grades.add(`B${match[1]}`);
  if (/B7\s*-\s*B10|B7\s*(?:THROUGH|TO)\s*B10/i.test(name)) ["B7", "B8", "B9", "B10"].forEach((g) => grades.add(g));
  if (/WASSCE|SHS|FORM/i.test(name)) ["SHS1", "SHS2", "SHS3"].forEach((g) => grades.add(g));
  const subjectTokens = ["COMPUTING", "ICT", "MATHEMATICS", "MATHS", "EMATHS", "SCIENCE", "ENGLISH", "SOCIAL STUDIES", "SOC", "RME", "FRENCH", "ARABIC", "GHANAIAN LANGUAGE", "CREATIVE ARTS", "HISTORY", "OWOP", "CAREER TECHNOLOGY", "PHYSICAL EDUCATION", "CHEMISTRY", "PHYSICS", "TWI"];
  const subject = subjectTokens.find((token) => name.toUpperCase().includes(token));
  const questionLike = /QUESTION|WASSCE|BECE|PAPER|TERM|SCHEME/i.test(name);
  const curriculumLike = /CURRICULUM|SYLLABUS/i.test(name);
  const contentType = curriculumLike && questionLike ? "mixed" : curriculumLike ? "curriculum" : /SCHEME/i.test(name) ? "marking_scheme" : questionLike ? "questions" : "unknown";
  const normalizedGrades = [...grades].map((grade) => normalizeGrade(grade)!).filter(Boolean);
  return {
    grades: normalizedGrades,
    educationLevel: educationLevelForGrade(normalizedGrades[0]),
    subject: normalizeSubject(subject),
    contentType: contentType as SourceDocument["contentType"],
  };
}

export async function discoverSources(root: string): Promise<SourceDocument[]> {
  const files = await walk(root);
  const sources: SourceDocument[] = [];
  for (const absolutePath of files) {
    const extension = path.extname(absolutePath).toLowerCase();
    if (![...supported, ".doc", ".zip"].includes(extension)) continue;
    const [buffer, info] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
    sources.push({
      absolutePath,
      relativePath: path.relative(root, absolutePath),
      extension,
      bytes: info.size,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      parseability: supported.has(extension) ? "supported" : "catalog-only",
      ...inferMetadata(absolutePath),
    });
  }
  return sources.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export async function extractText(source: SourceDocument): Promise<string> {
  const buffer = await readFile(source.absolutePath);
  if (source.extension === ".pdf") {
    const parser = new PDFParse({ data: buffer });
    try { return (await parser.getText()).text; } finally { await parser.destroy(); }
  }
  if (source.extension === ".docx") return (await mammoth.extractRawText({ buffer })).value;
  if ([".txt", ".csv", ".json"].includes(source.extension)) return buffer.toString("utf8");
  if ([".xlsx", ".xls"].includes(source.extension)) {
    const workbook = XLSX.read(buffer);
    return workbook.SheetNames.map((name) => XLSX.utils.sheet_to_csv(workbook.Sheets[name])).join("\n");
  }
  throw new Error(`Unsupported source type: ${source.extension}`);
}

function codeParts(code: string) {
  return code.split(".");
}

export function extractCurriculumNodes(source: SourceDocument, text: string): NormalizedCurriculumNode[] {
  const nodes = new Map<string, NormalizedCurriculumNode>();
  const curriculumCode = /CCP/i.test(text.slice(0, 8000)) ? "GH-CCP-2020" : "GH-SOURCE";
  const curriculumName = curriculumCode === "GH-CCP-2020" ? "Ghana Common Core Programme" : "Ghana Source Curriculum";
  const sourceVersion = source.sha256.slice(0, 12);
  for (const grade of source.grades) {
    const educationLevel = educationLevelForGrade(grade) ?? source.educationLevel ?? "Unclassified";
    const levelCode = `LEVEL:${educationLevel.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
    const gradeCode = `GRADE:${grade}`;
    const subjectCode = `SUBJECT:${grade}:${(source.subject ?? "Unclassified").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
    const structural = [
      { code: levelCode, title: educationLevel, nodeType: "education_level" as const, sourceTerminology: "Education Level", parentCode: undefined },
      { code: gradeCode, title: grade, nodeType: "grade" as const, sourceTerminology: "Grade / Form", parentCode: levelCode },
      { code: subjectCode, title: source.subject ?? "Unclassified", nodeType: "subject" as const, sourceTerminology: "Subject", parentCode: gradeCode },
    ];
    for (const item of structural) nodes.set(item.code, {
      externalSourceId: `${source.sha256}:${item.code}`,
      curriculumCode, curriculumName, curriculumVersion: "2020", country: "Ghana",
      ...item, educationLevel, grade: item.nodeType === "education_level" ? undefined : grade,
      subject: item.nodeType === "subject" ? source.subject : undefined,
      sourceFile: source.relativePath, sourceVersion, active: true,
    });
  }
  const pattern = /\b(B(?:[4-9]|10)(?:\.\d+){2,4})\b\s*[:\-–]?\s*([^\n]{3,300})/g;
  for (const match of text.matchAll(pattern)) {
    const code = match[1];
    const parts = codeParts(code);
    const nodeType = parts.length >= 5 ? "learning_indicator" : parts.length === 4 ? "content_standard" : parts.length === 3 ? "sub_strand" : "strand";
    const title = normalizeText(match[2]).replace(/-- \d+ of \d+ --.*$/, "").slice(0, 280);
    if (!title || nodes.has(code)) continue;
    const grade = parts[0];
    nodes.set(code, {
      externalSourceId: `${source.sha256}:${code}`,
      curriculumCode,
      curriculumName,
      curriculumVersion: "2020",
      country: "Ghana",
      nodeType,
      code,
      title,
      sourceTerminology: nodeType === "learning_indicator" ? "Learning Indicator" : nodeType === "content_standard" ? "Content Standard" : nodeType === "sub_strand" ? "Sub-strand" : "Strand",
      parentCode: parts.length > 3 ? parts.slice(0, -1).join(".") : `SUBJECT:${grade}:${(source.subject ?? "Unclassified").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
      educationLevel: educationLevelForGrade(grade),
      grade,
      subject: source.subject,
      sourceFile: source.relativePath,
      sourceVersion,
      active: true,
    });
  }
  return [...nodes.values()];
}

function value(row: Record<string, unknown>, ...names: string[]) {
  const key = Object.keys(row).find((candidate) => names.includes(candidate.toLowerCase().replace(/[^a-z0-9]/g, "")));
  return key ? String(row[key] ?? "").trim() : "";
}

export function normalizeQuestionRow(row: Record<string, unknown>, source: SourceDocument, index: number): NormalizedQuestion {
  const grade = normalizeGrade(value(row, "grade", "gradeform", "level")) ?? source.grades[0];
  const subject = normalizeSubject(value(row, "subject", "subjectname")) ?? source.subject;
  const options = ["a", "b", "c", "d"].map((key) => ({ key: key.toUpperCase(), text: value(row, `option${key}`, key) })).filter((option) => option.text);
  const answer = value(row, "answer", "correctanswer").toUpperCase().replace(/[^A-D]/g, "").slice(0, 1) || undefined;
  return {
    externalSourceId: value(row, "externalquestionid", "questionid", "id") || `${source.sha256}:${index + 1}`,
    sourceFile: source.relativePath,
    sourceHash: source.sha256,
    curriculumCode: value(row, "curriculum", "curriculumcode") || undefined,
    educationLevel: educationLevelForGrade(grade),
    grade,
    subject,
    strand: value(row, "strand", "domain", "topic") || undefined,
    subStrand: value(row, "substrand", "subtopic") || undefined,
    contentStandard: value(row, "contentstandard", "contentstandardcode") || undefined,
    learningIndicator: value(row, "learningindicator", "indicator", "indicatorcode") || undefined,
    learningObjective: value(row, "learningobjective", "objective") || undefined,
    questionType: options.length ? "multiple_choice" : /true|false/i.test(value(row, "questiontype", "type")) ? "true_false" : "unknown",
    questionText: value(row, "question", "questiontext", "stem"),
    options,
    correctAnswer: answer,
    explanation: value(row, "explanation", "rationale") || undefined,
    hint: value(row, "hint") || undefined,
    difficulty: ["easy", "medium", "hard"].includes(value(row, "difficulty").toLowerCase()) ? value(row, "difficulty").toLowerCase() as NormalizedQuestion["difficulty"] : undefined,
    cognitiveLevel: value(row, "cognitivelevel", "bloomslevel") || undefined,
    source: value(row, "source") || source.relativePath,
    reviewStatus: "review",
  };
}

export async function extractStructuredQuestions(source: SourceDocument): Promise<NormalizedQuestion[]> {
  const buffer = await readFile(source.absolutePath);
  let rows: Record<string, unknown>[] = [];
  if ([".xlsx", ".xls", ".csv"].includes(source.extension)) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    rows = workbook.SheetNames.flatMap((name) => XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name], { defval: "" }));
  } else if (source.extension === ".json") {
    const parsed = JSON.parse(buffer.toString("utf8"));
    rows = Array.isArray(parsed) ? parsed : parsed.questions ?? [];
  }
  return rows.map((row, index) => normalizeQuestionRow(row, source, index));
}

export function extractPdfQuestions(source: SourceDocument, text: string): NormalizedQuestion[] {
  const compact = text.replace(/-- \d+ of \d+ --/g, " ").replace(/\s+/g, " ");
  const answers = new Map<string, string>();
  const answerSection = compact.match(/(?:ANSWER|MARKING SCHEME)S?\s*[:\-]?\s*(.*)$/i)?.[1] ?? "";
  for (const match of answerSection.matchAll(/\b(\d{1,3})\s*[.):-]\s*([A-D])\b/gi)) answers.set(match[1], match[2].toUpperCase());
  const questions: NormalizedQuestion[] = [];
  const pattern = /(?:^|\s)(\d{1,3})\s*[.)]\s*(.{8,700}?)\s+a\s*[.)]\s*(.{1,220}?)\s+b\s*[.)]\s*(.{1,220}?)\s+c\s*[.)]\s*(.{1,220}?)\s+d\s*[.)]\s*(.{1,220}?)(?=\s+\d{1,3}\s*[.)]\s|\s+SECTION\s+[A-Z]|$)/gi;
  for (const match of compact.matchAll(pattern)) {
    const number = match[1];
    const questionText = normalizeText(match[2]);
    if (/^(?:what|which|who|where|when|how|the|a|an|identify|select|choose|state|calculate|find|evaluate|determine|name|define|true|false|\.{2,})/i.test(questionText) === false) continue;
    questions.push({
      externalSourceId: `${source.sha256}:${number}`,
      sourceFile: source.relativePath,
      sourceHash: source.sha256,
      educationLevel: source.educationLevel,
      grade: source.grades[0],
      subject: source.subject,
      questionType: "multiple_choice",
      questionText,
      options: ["A", "B", "C", "D"].map((key, index) => ({ key, text: normalizeText(match[index + 3]) })),
      correctAnswer: answers.get(number),
      source: source.relativePath,
      reviewStatus: "review",
    });
  }
  return questions;
}

export function auditQuestions(questions: NormalizedQuestion[]): AuditedQuestion[] {
  const seen = new Set<string>();
  return questions.map((question) => {
    const fingerprint = fingerprintQuestion(question.questionText);
    const issues = auditQuestion(question);
    if (seen.has(fingerprint)) issues.push({ severity: "rejected", code: "DUPLICATE_QUESTION", message: "Normalized question text is duplicated." });
    seen.add(fingerprint);
    const classification = issues.some((issue) => issue.severity === "rejected") ? "rejected" : issues.length ? "warning" : "valid";
    return { question, issues, fingerprint, classification };
  });
}

