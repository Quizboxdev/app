import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The mock-exam export route: the caller's own session decides; the file reflects what the database returned; a learner's typed answer can never run as a formula; every refusal is explained.
const userRpc = vi.fn();
vi.mock("@supabase/supabase-js", () => ({ createClient: (_u: string, _k: string, o: { global: { headers: { Authorization: string } } }) => ({ rpc: (fn: string, args: unknown) => userRpc(fn, args, o.global.headers.Authorization) }) }));
import { POST } from "./route";

const EXAM = "00000000-0000-4000-8000-000000000001", CLASS = "00000000-0000-4000-8000-000000000002";
const COLUMNS = ["Exam", "Participant", "Question text", "Student answer", "Correct", "Marks awarded"];
const RESULT = { dataset: "mock_exam_results", label: "Mock exam results: JHS 2 BECE readiness mock (version 1)", columns: COLUMNS, total: 3, truncated: false,
  rows: [["JHS 2 BECE readiness mock", "Esi Student", "What is 2 + 2?", "A: 4", true, 1], ["JHS 2 BECE readiness mock", "Kwame Student", "Name a gas", "=HYPERLINK(\"http://evil.example\",\"click\")", false, 0],
    ["JHS 2 BECE readiness mock", "Abena, \"A.\" Student", "What is 3 - 1?", "-2+3", false, 0]] };
const req = (body: unknown, auth = true) => new Request("https://www.quizbox.io/api/teacher/mock-exams/export", { method: "POST", headers: { ...(auth ? { authorization: "Bearer teacher-token" } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon"); vi.spyOn(console, "error").mockImplementation(() => undefined); userRpc.mockResolvedValue({ data: RESULT, error: null }); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); userRpc.mockReset(); });

describe("POST /api/teacher/mock-exams/export", () => {
  it("needs a signed-in caller and a valid request, and asks the database nothing otherwise", async () => {
    expect((await POST(req({ examId: EXAM }, false))).status).toBe(401);
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ examId: EXAM, classId: "not-an-id" }))).status).toBe(400);
    expect((await POST(req({ examId: EXAM, state: "everything" }))).status).toBe(400);
    expect((await POST(new Request("https://www.quizbox.io/x", { method: "POST", headers: { authorization: "Bearer t" }, body: "{not json" }))).status).toBe(400);
    expect(userRpc).not.toHaveBeenCalled();
  });
  it("asks with the caller's own session, never a service key, and passes the filters through", async () => {
    await POST(req({ examId: EXAM, classId: CLASS, state: "submitted", format: "csv" }));
    expect(userRpc).toHaveBeenCalledWith("qb_mock_export", { p_exam: EXAM, p_version: null, p_class: CLASS, p_student: null, p_question: null, p_state: "submitted", p_limit: 50000 }, "Bearer teacher-token");
  });
  it("returns a CSV with a clear name, a byte-order mark, and the row counts", async () => {
    const res = await POST(req({ examId: EXAM, format: "csv" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="quizbox-mock-exam-jhs-2-bece-readiness-mock-v1-results.csv"');
    expect(res.headers.get("x-export-rows")).toBe("3"); expect(res.headers.get("x-export-total")).toBe("3");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect([...new Uint8Array(await res.clone().arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await res.text();
    expect(text).toContain("Exam,Participant,Question text,Student answer,Correct,Marks awarded");
    expect(text).toContain("JHS 2 BECE readiness mock,Esi Student,What is 2 + 2?,A: 4,TRUE,1");
  });
  it("neutralises a typed answer that starts like a formula in the CSV", async () => {
    const lines = (await (await POST(req({ examId: EXAM, format: "csv" }))).text()).split("\r\n");
    expect(lines[2]).toContain("\"'=HYPERLINK(\"\"http://evil.example\"\",\"\"click\"\")\"");   // prefixed with an apostrophe and quoted
    expect(lines[3]).toContain(",'-2+3,");
    expect(lines[3]).toContain('"Abena, ""A."" Student"');                                     // commas and quotes are escaped, not split into columns
    expect(lines.slice(1).some((l) => /,=HYPERLINK/.test(l))).toBe(false);
  });
  it("returns an Excel file whose answers are text, never formulas", async () => {
    const res = await POST(req({ examId: EXAM, format: "xlsx" }));
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="quizbox-mock-exam-jhs-2-bece-readiness-mock-v1-results.xlsx"');
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Data", "About"]);
    const ws = wb.Sheets.Data;
    expect(XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })).toHaveLength(4);
    const evil = ws[XLSX.utils.encode_cell({ r: 2, c: 3 })];
    expect(evil.t).toBe("s"); expect(evil.f).toBeUndefined(); expect(evil.v).toBe('=HYPERLINK("http://evil.example","click")');
    expect(ws[XLSX.utils.encode_cell({ r: 1, c: 4 })].t).toBe("b");
    const about = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.About, { header: 1 }).flat().join(" ");
    expect(about).toContain("Mock exam results: JHS 2 BECE readiness mock (version 1)"); expect(about).toContain("Contains personal data");
  });
  it("says when the row limit cut the file short, and returns a small preview as JSON", async () => {
    userRpc.mockResolvedValue({ data: { ...RESULT, total: 120000, truncated: true }, error: null });
    const res = await POST(req({ examId: EXAM, format: "csv" }));
    expect(res.headers.get("x-export-total")).toBe("120000"); expect(res.headers.get("x-export-rows")).toBe("3");
    userRpc.mockClear(); userRpc.mockResolvedValue({ data: RESULT, error: null });
    const json = await (await POST(req({ examId: EXAM, format: "json" }))).json();
    expect(json).toMatchObject({ ok: true, total: 3, columns: COLUMNS });
    expect(userRpc.mock.calls[0][1].p_limit).toBe(20);
  });
  it("explains a refusal in words and never leaks a database error", async () => {
    userRpc.mockResolvedValue({ data: null, error: { message: "QB_NOT_FOUND" } });
    let res = await POST(req({ examId: EXAM })); expect(res.status).toBe(404); expect(await res.json()).toMatchObject({ ok: false, code: "QB_NOT_FOUND", error: "We could not find that." });
    userRpc.mockResolvedValue({ data: null, error: { message: "QB_MOCK_AUTHOR_FORBIDDEN" } });
    res = await POST(req({ examId: EXAM })); expect(res.status).toBe(403);
    userRpc.mockResolvedValue({ data: null, error: { message: "QB_FEATURE_DISABLED" } });
    res = await POST(req({ examId: EXAM })); expect(res.status).toBe(403); expect((await res.json()).error).toMatch(/not open yet/);
    userRpc.mockResolvedValue({ data: null, error: { message: 'relation "public.secret_table" does not exist' } });
    res = await POST(req({ examId: EXAM })); const body = await res.json();
    expect(res.status).toBe(500); expect(JSON.stringify(body)).not.toContain("secret_table");
  });
});
