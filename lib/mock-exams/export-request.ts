// Reads and checks a mock-exam results export request from the browser. Everything is an id or a fixed word; the database re-checks who may read what, so this only keeps malformed requests out.
export type MockExportRequest = { examId: string; versionId: string | null; classId: string | null; studentId: string | null; questionId: string | null; state: "submitted" | "in_progress" | "expired" | null; format: "csv" | "xlsx" | "json" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseMockExportRequest(body: unknown): { ok: true; value: MockExportRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const id = (v: unknown): string | null | undefined => (v === undefined || v === null || v === "" ? null : typeof v === "string" && UUID.test(v) ? v : undefined);
  const examId = id(b.examId);
  if (!examId) return { ok: false, error: "Choose an exam to export." };
  const versionId = id(b.versionId), classId = id(b.classId), studentId = id(b.studentId), questionId = id(b.questionId);
  if ([versionId, classId, studentId, questionId].includes(undefined)) return { ok: false, error: "That filter is not valid." };
  const state = b.state === undefined || b.state === null || b.state === "" ? null : (["submitted", "in_progress", "expired"] as const).find((s) => s === b.state);
  if (state === undefined) return { ok: false, error: "That filter is not valid." };
  const format = b.format === "xlsx" || b.format === "json" ? b.format : "csv";
  return { ok: true, value: { examId, versionId: versionId ?? null, classId: classId ?? null, studentId: studentId ?? null, questionId: questionId ?? null, state, format } };
}

// "Mock exam results: JHS 2 BECE readiness mock (version 2)" -> "quizbox-mock-exam-jhs-2-bece-readiness-mock-v2-results.csv"
export function mockExportFileName(label: string, ext: "csv" | "xlsx"): string {
  const m = /^Mock exam results:\s*(.*?)\s*\(version (\d+)\)\s*$/.exec(label);
  const title = (m ? m[1] : label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "exam";
  return `quizbox-mock-exam-${title}${m ? `-v${m[2]}` : ""}-results.${ext}`;
}
