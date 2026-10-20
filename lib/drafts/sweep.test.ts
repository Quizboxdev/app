import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The sweep emails each warning once, never fails the run, and reports counts only.
const { rpc, sendEmail } = vi.hoisted(() => ({ rpc: vi.fn(), sendEmail: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendEmail }));
vi.mock("@/lib/managed/server", () => ({ reply: (status: number, body: unknown) => Response.json(body, { status }), admin: () => ({ rpc }) }));
import { runDraftSweep } from "./sweep";
import { GET } from "../../app/api/cron/drafts/route";

const SECRET = "a-long-enough-cron-secret-value";
beforeEach(() => { rpc.mockReset(); sendEmail.mockReset(); process.env.CRON_SECRET = SECRET; });
afterEach(() => { delete process.env.CRON_SECRET; });

describe("draft sweep", () => {
  it("emails each warned person with a link back, counts results, and skips people without an address", async () => {
    rpc.mockResolvedValue({ data: { purged: 3, warned: [
      { label: "competition", title: "Spelling Cup", path: "/creator?format=competition", email: "a@example.com" },
      { label: "practice set", title: "", path: "//evil.example", email: "b@example.com" },
      { label: "work", title: "x", path: "/drafts", email: null },
      { label: "assignment", title: "y", path: "/drafts", email: "c@example.com" }] }, error: null });
    sendEmail.mockImplementation(async (to: string) => (to === "c@example.com" ? "failed" : "sent"));
    const out = await runDraftSweep({ rpc } as never);
    expect(out).toEqual({ purged: 3, warned: 4, emailed: 2, skipped: 1, failed: 1 });
    expect(sendEmail.mock.calls[0][1]).toBe("Your unfinished competition will be deleted in about 2 hours");
    expect(sendEmail.mock.calls[0][2]).toContain("Spelling Cup"); expect(sendEmail.mock.calls[0][2]).toContain("/creator?format=competition");
    expect(sendEmail.mock.calls[1][2]).toContain("/drafts"); expect(sendEmail.mock.calls[1][2]).not.toContain("evil.example");     // only in-app paths are linked
  });

  it("does nothing, quietly, when the database answers badly or the holder is not installed", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    expect(await runDraftSweep({ rpc } as never)).toEqual({ purged: 0, warned: 0, emailed: 0, skipped: 0, failed: 0 });
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await runDraftSweep({ rpc } as never)).toEqual({ purged: 0, warned: 0, emailed: 0, skipped: 0, failed: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("the scheduled route is closed without the secret and answers with counts only", async () => {
    const call = (token?: string) => GET(new Request("https://www.quizbox.io/api/cron/drafts", { headers: token ? { authorization: `Bearer ${token}` } : {} }));
    expect((await call()).status).toBe(401); expect((await call("nope-nope-nope-nope-nope!")).status).toBe(401);
    delete process.env.CRON_SECRET; expect((await call(SECRET)).status).toBe(503); process.env.CRON_SECRET = SECRET;
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: { purged: 1, warned: [{ label: "challenge", title: "Private title", path: "/drafts", email: "a@example.com" }] }, error: null }); sendEmail.mockResolvedValue("sent");
    const res = await call(SECRET), body = await res.json();
    expect(res.status).toBe(200); expect(body).toEqual({ ok: true, purged: 1, warned: 1, emailed: 1, skipped: 0, failed: 0 });
    expect(JSON.stringify(body)).not.toMatch(/Private title|example\.com/);
  });
});
