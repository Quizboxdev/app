import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The export route: the caller's own session decides; the file reflects what the database returned; every refusal is explained.
const userRpc = vi.fn();
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: userRpc }) }));
import { POST } from "./route";

const RESULT = { dataset: "payments", label: "Payments", columns: ["Reference", "Created (UTC)", "Amount"], rows: [["QB-1", "2026-10-23 17:09:48", 40], ["QB-2", "2026-10-22 08:00:00", 5]], total: 2, truncated: false };
const req = (body: unknown, auth = true) => new Request("https://www.quizbox.io/api/admin/export", { method: "POST", headers: { ...(auth ? { authorization: "Bearer t" } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon"); vi.spyOn(console, "error").mockImplementation(() => undefined); userRpc.mockResolvedValue({ data: RESULT, error: null }); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); userRpc.mockReset(); });

describe("POST /api/admin/export", () => {
  it("needs a signed-in caller and a valid request", async () => {
    expect((await POST(req({ dataset: "payments" }, false))).status).toBe(401);
    expect((await POST(req({ dataset: "" }))).status).toBe(400);
    expect((await POST(req({ dataset: "payments", from: "2026-13-01" }))).status).toBe(400);
    expect((await POST(req({ dataset: "payments", from: "2026-10-23", to: "2026-10-01" }))).status).toBe(400);
    expect(userRpc).not.toHaveBeenCalled();
  });
  it("asks the database with the caller's session, turning days into a half-open range", async () => {
    await POST(req({ dataset: "payments", from: "2026-10-01", to: "2026-10-23", category: "successful", format: "csv" }));
    expect(userRpc).toHaveBeenCalledWith("qb_export_run", { p_dataset: "payments", p_from: "2026-10-01T00:00:00Z", p_to: "2026-10-24T00:00:00Z", p_category: "successful", p_limit: 50000 });
  });
  it("returns a CSV file with a clear name", async () => {
    const res = await POST(req({ dataset: "payments", from: "2026-10-01", to: "2026-10-23", format: "csv" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="quizbox-payments-2026-10-01_to_2026-10-23.csv"');
    const text = await res.text();
    expect(text).toContain("Reference,Created (UTC),Amount"); expect(text).toContain("QB-1,2026-10-23 17:09:48,40");
  });
  it("returns an Excel file that opens with the same rows", async () => {
    const res = await POST(req({ dataset: "payments", format: "xlsx" }));
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Data", "About"]);
    expect(XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Data, { header: 1 }).length).toBe(3);
  });
  it("returns a short preview as JSON without asking for a full export", async () => {
    const res = await POST(req({ dataset: "payments", format: "json" }));
    expect(await res.json()).toMatchObject({ ok: true, total: 2, columns: ["Reference", "Created (UTC)", "Amount"] });
    expect(userRpc.mock.calls[0][1].p_limit).toBe(20);
  });
  it("explains a refusal and never leaks a database error", async () => {
    userRpc.mockResolvedValue({ data: null, error: { message: "QB_FORBIDDEN" } });
    let res = await POST(req({ dataset: "users" })); expect(res.status).toBe(403); expect(await res.json()).toMatchObject({ code: "QB_FORBIDDEN", error: expect.stringMatching(/permission/) });
    userRpc.mockResolvedValue({ data: null, error: { message: "relation \"public.secret_table\" does not exist" } });
    res = await POST(req({ dataset: "payments" })); const body = await res.json();
    expect(res.status).toBe(500); expect(JSON.stringify(body)).not.toContain("secret_table");
  });
});
