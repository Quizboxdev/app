import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => {
  const result = { data: [], error: null, count: 0 };
  const query: any = { then: (resolve: any) => Promise.resolve(result).then(resolve) };
  for (const name of ["select", "insert", "update", "eq", "in", "is", "or", "order", "range", "limit", "single", "ilike"]) query[name] = vi.fn(() => query);
  return { query, rpc: vi.fn(async () => ({ data: {}, error: null })), from: vi.fn(() => query) };
});
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => mock }));
import { createClass, publishAssignment, listGradebook, listTeacherClasses, listIndicatorLearners } from "./teacher";
import { joinClass } from "./student";
import { listCurriculumNodes, getQuestionAvailability } from "./curriculum";
import { startAttempt, getAttempt, saveResponse, submitAttempt, getResult, getAttemptReview, getMyResults, savePracticeResponse } from "./assessment";

beforeEach(() => { vi.clearAllMocks(); });
describe("accepted learning-loop API contracts", () => {
  it("creates a class through the existing RLS table", async () => { await createClass({ class_name: "Test", teacher_user_id: "teacher" }); expect(mock.from).toHaveBeenCalledWith("classes"); expect(mock.query.insert).toHaveBeenCalledWith({ class_name: "Test", teacher_user_id: "teacher" }); });
  it("normalizes class joining through its RPC", async () => { await joinClass(" qb123 "); expect(mock.rpc).toHaveBeenCalledWith("qb_join_class", { p_join_code: "QB123" }); });
  it("preserves scoped curriculum navigation", async () => { await listCurriculumNodes({ curriculumId: "c", parentId: "p", nodeType: "learning_indicator" }); expect(mock.query.eq).toHaveBeenCalledWith("curriculum_id", "c"); expect(mock.query.eq).toHaveBeenCalledWith("parent_id", "p"); });
  it("checks approved availability through its RPC", async () => { await getQuestionAvailability(["n"]); expect(mock.rpc).toHaveBeenCalledWith("qb_question_availability", expect.objectContaining({ p_curriculum_node_ids: ["n"] })); });
  it.each(["MANUAL", "AUTOMATIC"] as const)("preserves %s selection and targeted publication", async (selectionMode) => {
    await publishAssignment({ classId: "c", title: "t", description: "", curriculumNodeIds: ["n"], questionCount: 1, selectionMode, questionIds: selectionMode === "MANUAL" ? ["q"] : undefined, mode: "PRACTICE", attemptsAllowed: 1, timeLimitMinutes: 20, targetStudentIds: ["a"] });
    expect(mock.rpc).toHaveBeenCalledWith("qb_publish_assignment", expect.objectContaining({ p_selection_mode: selectionMode, p_question_ids: selectionMode === "MANUAL" ? ["q"] : null, p_target_student_ids: ["a"], p_mode: "PRACTICE" }));
  });
  it("includes explicit nullable standalone attempt context", async () => { await startAttempt({ assessmentId: "a" }); expect(mock.rpc).toHaveBeenCalledWith("qb_start_attempt", expect.objectContaining({ p_assignment_id: null, p_class_id: null })); });
  it("resumes using the existing attempt RPC", async () => { await getAttempt("a"); expect(mock.rpc).toHaveBeenCalledWith("qb_get_attempt", { p_attempt_id: "a" }); });
  it("saves learner input without client correctness", async () => { await saveResponse({ attemptId: "a", questionId: "q", selectedAnswer: "B" }); expect(mock.rpc).toHaveBeenCalledWith("qb_save_response", { p_attempt_id: "a", p_question_id: "q", p_selected_answer: "B", p_selected_value: null, p_response_seconds: 0 }); });
  it("uses server-authoritative completion", async () => { await submitAttempt("a"); expect(mock.rpc).toHaveBeenCalledWith("qb_complete_attempt", { p_attempt_id: "a", p_submission_reason: "student_submit" }); });
  it("uses separate result and post-submission review APIs", async () => { await getResult("a"); await getAttemptReview("a"); expect(mock.rpc).toHaveBeenCalledWith("qb_get_result", { p_attempt_id: "a" }); expect(mock.rpc).toHaveBeenCalledWith("qb_get_attempt_review", { p_attempt_id: "a" }); });
  it("bounds result history", async () => { await getMyResults(10); expect(mock.rpc).toHaveBeenCalledWith("qb_my_results", { p_limit: 10 }); });
  it("uses a distinct practice feedback path", async () => { await savePracticeResponse({ attemptId: "a", questionId: "q", selectedAnswer: "A" }); expect(mock.rpc).toHaveBeenCalledWith("qb_save_practice_response", expect.objectContaining({ p_attempt_id: "a", p_question_id: "q" })); });
  it("scopes teacher class lookup to either ownership column", async () => { await listTeacherClasses("t"); expect(mock.query.or).toHaveBeenCalledWith("primary_teacher_id.eq.t,teacher_id.eq.t"); });
  it("does not fetch gradebook without authorized classes", async () => { await listGradebook("t"); expect(mock.from).not.toHaveBeenCalledWith("gradebook"); });
  it("scopes learner drill-down to class and objective", async () => { await listIndicatorLearners("c", "n"); expect(mock.query.eq).toHaveBeenCalledWith("class_id", "c"); expect(mock.query.eq).toHaveBeenCalledWith("curriculum_node_id", "n"); });
});
