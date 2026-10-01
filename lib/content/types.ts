export type CurriculumNodeType =
  | "education_level"
  | "grade"
  | "subject"
  | "strand"
  | "sub_strand"
  | "topic"
  | "subtopic"
  | "content_standard"
  | "learning_indicator"
  | "learning_objective";

export interface SourceDocument {
  absolutePath: string;
  relativePath: string;
  extension: string;
  bytes: number;
  sha256: string;
  parseability: "supported" | "catalog-only";
  educationLevel?: string;
  grades: string[];
  subject?: string;
  contentType: "curriculum" | "questions" | "marking_scheme" | "mixed" | "unknown";
}

export interface NormalizedCurriculumNode {
  externalSourceId: string;
  curriculumCode: string;
  curriculumName: string;
  curriculumVersion: string;
  country: string;
  nodeType: CurriculumNodeType;
  code: string;
  title: string;
  sourceTerminology: string;
  parentCode?: string;
  educationLevel?: string;
  grade?: string;
  subject?: string;
  sourceFile: string;
  sourceVersion: string;
  active: boolean;
}

export interface NormalizedQuestion {
  externalSourceId: string;
  sourceFile: string;
  sourceHash: string;
  curriculumCode?: string;
  educationLevel?: string;
  grade?: string;
  subject?: string;
  strand?: string;
  subStrand?: string;
  topic?: string;
  contentStandard?: string;
  learningIndicator?: string;
  learningObjective?: string;
  questionType: "multiple_choice" | "true_false" | "unknown";
  questionText: string;
  options: Array<{ key: string; text: string }>;
  correctAnswer?: string;
  explanation?: string;
  hint?: string;
  difficulty?: "easy" | "medium" | "hard";
  cognitiveLevel?: string;
  source: string;
  reviewStatus: "draft" | "review" | "approved" | "rejected";
}

export interface QualityIssue {
  severity: "warning" | "rejected";
  code: string;
  message: string;
}

export interface AuditedQuestion {
  question: NormalizedQuestion;
  classification: "valid" | "warning" | "rejected";
  issues: QualityIssue[];
  fingerprint: string;
}

