import { createHash } from "node:crypto";
import type { NormalizedQuestion, QualityIssue } from "./types";

const subjectAliases: Record<string, string> = {
  ICT: "Computing",
  COMPUTING: "Computing",
  MATH: "Mathematics",
  MATHS: "Mathematics",
  MATHEMATICS: "Mathematics",
  SCI: "Science",
  SCIENCE: "Science",
  "INTEGRATED SCIENCE": "Science",
  ENG: "English Language",
  ENGLISH: "English Language",
  SOC: "Social Studies",
  "SOCIAL STUDIES": "Social Studies",
  RME: "Religious and Moral Education",
  OWOP: "Our World Our People",
  "CREATIVE ARTS": "Creative Arts and Design",
  "CREATIVE ARTS AND DESIGNS": "Creative Arts and Design",
  "CORE MATHS": "Core Mathematics",
  EMATHS: "Elective Mathematics",
};

export function normalizeSubject(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  const cleaned = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return subjectAliases[cleaned.toUpperCase()] ?? cleaned.replace(/\b\w/g, (m) => m.toUpperCase());
}

export function normalizeGrade(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  const upper = value.toUpperCase().replace(/\s+/g, " ").trim();
  const basic = upper.match(/(?:BASIC|B|JHS)\s*-?\s*(\d{1,2})/);
  if (basic) {
    const number = upper.startsWith("JHS") ? Number(basic[1]) + 6 : Number(basic[1]);
    return `B${number}`;
  }
  const shs = upper.match(/(?:SHS|FORM)\s*-?\s*(\d)/);
  return shs ? `SHS${shs[1]}` : upper;
}

export function educationLevelForGrade(grade?: string): string | undefined {
  if (!grade) return undefined;
  if (/^B[1-6]$/.test(grade)) return "Basic Primary";
  if (/^B(?:7|8|9|10)$/.test(grade)) return "JHS / Common Core";
  if (/^SHS[1-3]$/.test(grade)) return "SHS";
  return undefined;
}

export function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function fingerprintQuestion(text: string): string {
  const normalized = normalizeText(text).toLowerCase().replace(/[^a-z0-9 ]/g, "");
  return createHash("sha256").update(normalized).digest("hex");
}

export function auditQuestion(question: NormalizedQuestion): QualityIssue[] {
  const issues: QualityIssue[] = [];
  if (!normalizeText(question.questionText)) {
    issues.push({ severity: "rejected", code: "EMPTY_QUESTION", message: "Question text is empty." });
  }
  if (question.questionType === "unknown") {
    issues.push({ severity: "warning", code: "UNKNOWN_TYPE", message: "Question type needs review." });
  }
  if (question.questionType === "multiple_choice") {
    if (question.options.length < 4) {
      issues.push({ severity: "rejected", code: "TOO_FEW_OPTIONS", message: "MCQ has fewer than four options." });
    }
    const unique = new Set(question.options.map((option) => normalizeText(option.text).toLowerCase()));
    if (unique.size !== question.options.length) {
      issues.push({ severity: "rejected", code: "DUPLICATE_OPTIONS", message: "MCQ contains duplicate options." });
    }
    if (!question.correctAnswer) {
      issues.push({ severity: "rejected", code: "MISSING_ANSWER", message: "MCQ has no correct answer." });
    } else if (!question.options.some((option) => option.key === question.correctAnswer)) {
      issues.push({ severity: "rejected", code: "INVALID_ANSWER", message: "Correct answer does not match an option key." });
    }
  }
  if (!question.subject) {
    issues.push({ severity: "warning", code: "MISSING_SUBJECT", message: "Subject could not be normalized." });
  }
  if (!question.grade) {
    issues.push({ severity: "warning", code: "MISSING_GRADE", message: "Grade could not be normalized." });
  }
  if (!question.learningIndicator && !question.learningObjective) {
    issues.push({ severity: "warning", code: "UNMAPPED_CURRICULUM", message: "No indicator or objective was mapped." });
  }
  return issues;
}

