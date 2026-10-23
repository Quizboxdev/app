import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Audit QB-AUD-007: the Origin header can be forged from outside a browser, so counts are also limited per device. One view and one share per challenge per device per hour.
const rpc = vi.fn();
vi.mock("@/lib/supabase/server-admin", () => ({ getSupabaseAdminClient: () => ({ rpc }) }));
import { POST } from "./route";

const call = (body: unknown, ip = "203.0.113.7", origin: string | null = "https://quizbox.io") => POST(new Request("https://quizbox.io/api/challenges/view", { method: "POST", headers: { host: "quizbox.io", "x-forwarded-for": ip, ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }));
let used: Set<string>;
beforeEach(() => { vi.stubEnv("INTAKE_HASH_SALT", "test-salt-123456"); used = new Set();
  rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "qb_consume_budget") { const k = String(args.p_key); if (used.has(k)) return { data: false, error: null }; used.add(k); return { data: true, error: null }; }
    return { data: null, error: null };
  }); });
afterEach(() => { vi.unstubAllEnvs(); rpc.mockReset(); });
const counted = (fn: string) => rpc.mock.calls.filter((c) => c[0] === fn).length;

describe("POST /api/challenges/view", () => {
  it("counts a view once per device per hour, however many times it is sent", async () => {
    for (let i = 0; i < 5; i++) expect((await call({ slug: "quiz-one", event: "view" })).status).toBe(204);
    expect(counted("challenge_track_view")).toBe(1);
    await call({ slug: "quiz-one", event: "view" }, "198.51.100.9"); expect(counted("challenge_track_view")).toBe(2);       // a different device counts
    await call({ slug: "quiz-two", event: "view" }); expect(counted("challenge_track_view")).toBe(3);                         // so does a different challenge
  });
  it("limits shares the same way, separately from views, and never stores the address", async () => {
    await call({ slug: "quiz-one", event: "view" }); await call({ slug: "quiz-one", event: "share" }); await call({ slug: "quiz-one", event: "share" });
    expect(counted("challenge_track_view")).toBe(1); expect(counted("challenge_track_share")).toBe(1);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("203.0.113.7");
  });
  it("still refuses a missing or foreign origin, a bad body and a bad slug", async () => {
    expect((await call({ slug: "quiz-one", event: "view" }, "1.1.1.1", null)).status).toBe(403);
    expect((await call({ slug: "quiz-one", event: "view" }, "1.1.1.1", "https://evil.example")).status).toBe(403);
    expect((await call({ slug: "Bad Slug!", event: "view" })).status).toBe(400);
    expect(counted("challenge_track_view")).toBe(0);
  });
  it("does not count anything when the limiter cannot run, instead of counting unlimited", async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { message: "boom" } }));
    expect((await call({ slug: "quiz-one", event: "view" })).status).toBe(204);
    expect(counted("challenge_track_view")).toBe(0);
  });
});
