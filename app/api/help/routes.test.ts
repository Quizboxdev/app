import { afterEach, describe, expect, it, vi } from "vitest";
import { SITE_URL } from "@/lib/site";

// Help search and the view/vote counter: public, limited, and quiet about failures.
const rpc = vi.fn();
vi.mock("@/lib/supabase/server-admin", () => ({ getSupabaseAdminClient: () => ({ rpc }) }));
import { GET as search } from "./search/route";
import { POST as track } from "./track/route";

const ORIGIN = new URL(SITE_URL).origin, HOST = new URL(SITE_URL).host;
const post = (body: unknown, headers: Record<string, string> = { origin: ORIGIN, host: HOST }) => new Request(`${ORIGIN}/api/help/track`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rpc.mockReset(); });

describe("GET /api/help/search", () => {
  it("answers nothing, without asking the database, for a search that is too short", async () => {
    const res = await search(new Request(`${ORIGIN}/api/help/search?q=a`));
    expect(await res.json()).toEqual({ ok: true, results: [] }); expect(rpc).not.toHaveBeenCalled();
  });
  it("passes a clean query and a known audience to the database, and ignores an unknown audience", async () => {
    rpc.mockResolvedValue({ data: [{ slug: "join-a-class", title: "Join a class", summary: "x", category: "classes" }], error: null });
    const res = await search(new Request(`${ORIGIN}/api/help/search?q=${encodeURIComponent("  class code  ")}&audience=student`));
    expect((await res.json()).results[0].slug).toBe("join-a-class");
    expect(rpc).toHaveBeenCalledWith("qb_help_search", { p_query: "class code", p_audience: "student" });
    await search(new Request(`${ORIGIN}/api/help/search?q=class&audience=admin`));
    expect(rpc).toHaveBeenLastCalledWith("qb_help_search", { p_query: "class", p_audience: null });
  });
  it("fails quietly with an empty list if the database is not available", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValue({ data: null, error: { code: "42883", message: "function does not exist" } });
    const res = await search(new Request(`${ORIGIN}/api/help/search?q=password`));
    expect(res.status).toBe(503); expect(await res.json()).toEqual({ ok: false, results: [] });
  });
});

describe("POST /api/help/track", () => {
  it("only accepts the site's own pages, small bodies, known events and real guide names", async () => {
    expect((await track(post({ slug: "join-a-class", event: "view" }, { origin: "https://evil.example", host: HOST }))).status).toBe(403);
    expect((await track(post({ slug: "join-a-class", event: "view" }, { host: HOST }))).status).toBe(403);
    expect((await track(post("x".repeat(500)))).status).toBe(413);
    expect((await track(post("not json"))).status).toBe(400);
    expect((await track(post({ slug: "Join A Class", event: "view" }))).status).toBe(400);
    expect((await track(post({ slug: "join-a-class", event: "explode" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("counts once per device per guide per kind per hour", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    rpc.mockImplementation(async (fn: string) => (fn === "qb_consume_budget" ? { data: true, error: null } : { data: null, error: null }));
    expect((await track(post({ slug: "join-a-class", event: "yes" }))).status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("qb_help_track", { p_slug: "join-a-class", p_event: "yes" });
    const budget = rpc.mock.calls.find((c) => c[0] === "qb_consume_budget")![1];
    expect(budget).toMatchObject({ p_limit: 1, p_seconds: 3600 }); expect(budget.p_key).toMatch(/^help:yes:join-a-class:[0-9a-f]{24}$/);
    rpc.mockReset(); rpc.mockImplementation(async (fn: string) => (fn === "qb_consume_budget" ? { data: false, error: null } : { data: null, error: null }));
    expect((await track(post({ slug: "join-a-class", event: "yes" }))).status).toBe(204);
    expect(rpc).not.toHaveBeenCalledWith("qb_help_track", expect.anything());                  // a repeat from the same device is not counted
  });
});
