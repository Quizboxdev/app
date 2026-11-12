import { beforeEach, describe, expect, it, vi } from "vitest";

// The assignment sweep reports counts only, and one half failing never stops the other.
const { rpc, logFallback } = vi.hoisted(() => ({ rpc: vi.fn(), logFallback: vi.fn() }));
vi.mock("@/lib/ops/log", () => ({ logFallback }));
vi.mock("@/lib/managed/server", () => ({ reply: (status: number, body: unknown) => Response.json(body, { status }), admin: () => ({ rpc }) }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }));
vi.mock("@/lib/drafts/sweep", () => ({ runDraftSweep: vi.fn().mockResolvedValue({}) }));
import { runAssignmentSweep } from "./sweep";
import { GET } from "../../app/api/cron/push/route";

const SECRET = "a-long-enough-cron-secret-value";
beforeEach(() => { rpc.mockReset(); logFallback.mockReset(); process.env.CRON_SECRET = SECRET; process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub"; process.env.VAPID_PRIVATE_KEY = "priv"; });

describe("assignment sweep", () => {
  it("adds up what the database reports and nothing else", async () => {
    rpc.mockImplementation(async (name: string) => name === "qb_schedules_run"
      ? { data: { enabled: true, published: 2, skipped: 1, missed: 1 }, error: null } : { data: { enabled: true, assignments: 1, reminders: 7 }, error: null });
    expect(await runAssignmentSweep({ rpc } as never)).toEqual({ published: 2, skipped: 1, missed: 1, reminded: 7, failed: 0 });
  });

  it("still sends reminders when the weekly runner fails, and counts the failure", async () => {
    rpc.mockImplementation(async (name: string) => name === "qb_schedules_run"
      ? { data: null, error: { message: "function does not exist" } } : { data: { reminders: 3 }, error: null });
    expect(await runAssignmentSweep({ rpc } as never)).toEqual({ published: 0, skipped: 0, missed: 0, reminded: 3, failed: 1 });
  });

  it("is quiet when the feature is off (the database answers with zeros)", async () => {
    rpc.mockResolvedValue({ data: { enabled: false, published: 0, skipped: 0, missed: 0, assignments: 0, reminders: 0 }, error: null });
    expect(await runAssignmentSweep({ rpc } as never)).toEqual({ published: 0, skipped: 0, missed: 0, reminded: 0, failed: 0 });
  });
});

describe("the push cron route", () => {
  it("runs the assignment sweep on every authorised tick and never lets it change the push answer", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "qb_push_pending") return { data: [], error: null };
      if (name === "qb_schedules_run") throw new Error("boom");
      return { data: null, error: null };
    });
    const res = await GET(new Request("https://x.test/api/cron/push", { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, notifications: 0, sent: 0, gone: 0, failed: 0 });
    expect(rpc.mock.calls.map((c) => c[0])).toContain("qb_schedules_run");
    expect(logFallback).toHaveBeenCalledWith("cron-push", expect.stringContaining("assignment sweep failed"), expect.any(Error));
  });
});
