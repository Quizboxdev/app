import { afterEach, describe, expect, it, vi } from "vitest";
import { SITE_URL } from "@/lib/site";

// Help video counters: the play count (POST /api/help/video-track) and "Watch on YouTube" (GET /go/video/<id>). Public, limited, quiet about failures, and the redirect is built only from the stored video id.
const rpc = vi.fn();
vi.mock("@/lib/supabase/server-admin", () => ({ getSupabaseAdminClient: () => ({ rpc }) }));
import { POST as track } from "./video-track/route";
import { GET as watch } from "../../go/video/[id]/route";

const ORIGIN = new URL(SITE_URL).origin, HOST = new URL(SITE_URL).host;
const ID = "00000000-0000-4000-8000-000000000001", YT = "dQw4w9WgXcQ";
const post = (body: unknown, headers: Record<string, string> = { origin: ORIGIN, host: HOST }) => new Request(`${ORIGIN}/api/help/video-track`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const go = (id: string, headers: Record<string, string> = {}) => watch(new Request(`${ORIGIN}/go/video/${id}`, { headers }), { params: Promise.resolve({ id }) });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rpc.mockReset(); });

describe("POST /api/help/video-track", () => {
  it("only accepts the site's own pages, small bodies, the play event and a real video id", async () => {
    expect((await track(post({ id: ID, event: "play" }, { origin: "https://evil.example", host: HOST }))).status).toBe(403);
    expect((await track(post({ id: ID, event: "play" }, { host: HOST }))).status).toBe(403);
    expect((await track(post("x".repeat(500)))).status).toBe(413);
    expect((await track(post("not json"))).status).toBe(400);
    expect((await track(post({ id: "../x", event: "play" }))).status).toBe(400);
    expect((await track(post({ id: ID, event: "outbound" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("counts one play per device per hour, and nothing when the limiter says no", async () => {
    vi.stubEnv("INTAKE_HASH_SALT", "salt");
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: null, error: null });
    expect((await track(post({ id: ID, event: "play" }))).status).toBe(204);
    expect(rpc).toHaveBeenNthCalledWith(1, "qb_consume_budget", expect.objectContaining({ p_key: expect.stringMatching(new RegExp(`^helpvideo:play:${ID}:[0-9a-f]{24}$`)), p_limit: 1, p_seconds: 3600 }));
    expect(rpc).toHaveBeenNthCalledWith(2, "qb_help_video_track", { p_id: ID, p_event: "play" });
    rpc.mockReset(); rpc.mockResolvedValueOnce({ data: false, error: null });
    expect((await track(post({ id: ID, event: "play" }))).status).toBe(204);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("never fails loudly", async () => {
    vi.stubEnv("INTAKE_HASH_SALT", "salt"); rpc.mockRejectedValue(new Error("down"));
    expect((await track(post({ id: ID, event: "play" }))).status).toBe(204);
  });
});

describe("GET /go/video/<id>", () => {
  it("sends the person to the stored YouTube video and counts the click", async () => {
    vi.stubEnv("INTAKE_HASH_SALT", "salt");
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: YT, error: null });
    const res = await go(ID, { "x-forwarded-for": "10.0.0.1" });
    expect(res.status).toBe(302); expect(res.headers.get("location")).toBe(`https://www.youtube.com/watch?v=${YT}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(rpc).toHaveBeenNthCalledWith(2, "qb_help_video_outbound", { p_id: ID, p_count: true });
  });
  it("still sends the person on, without counting again, when this device was counted this hour", async () => {
    vi.stubEnv("INTAKE_HASH_SALT", "salt");
    rpc.mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: YT, error: null });
    const res = await go(ID);
    expect(res.headers.get("location")).toBe(`https://www.youtube.com/watch?v=${YT}`);
    expect(rpc).toHaveBeenNthCalledWith(2, "qb_help_video_outbound", { p_id: ID, p_count: false });
  });
  it("sends everything else to the Help centre: a bad id, a draft or unknown video, a strange answer, a database problem", async () => {
    vi.stubEnv("INTAKE_HASH_SALT", "salt");
    const help = `${ORIGIN}/help`;
    expect((await go("not-a-uuid")).headers.get("location")).toBe(help); expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: null, error: null });
    expect((await go(ID)).headers.get("location")).toBe(help);
    rpc.mockReset(); rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: "https://evil.example/x", error: null });
    expect((await go(ID)).headers.get("location")).toBe(help);                                                                     // never an address from the database, only a video id
    rpc.mockReset(); rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await go(ID)).headers.get("location")).toBe(help);
    rpc.mockReset(); rpc.mockRejectedValue(new Error("down"));
    expect((await go(ID)).headers.get("location")).toBe(help);
  });
});
