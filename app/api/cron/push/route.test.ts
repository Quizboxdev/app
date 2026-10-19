import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The push sender: closed without secrets, one dead device never stops the batch, answers carry counts only.
const { rpc, sendNotification, setVapidDetails } = vi.hoisted(() => ({ rpc: vi.fn(), sendNotification: vi.fn(), setVapidDetails: vi.fn() }));
vi.mock("@/lib/managed/server", () => ({ reply: (status: number, body: unknown) => Response.json(body, { status }), admin: () => ({ rpc }) }));
vi.mock("web-push", () => ({ default: { sendNotification, setVapidDetails } }));
import { GET } from "./route";

const SECRET = "a-long-enough-cron-secret-value";
const call = (token?: string) => GET(new Request("https://www.quizbox.io/api/cron/push", { headers: token ? { authorization: `Bearer ${token}` } : {} }));
const env = () => { process.env.CRON_SECRET = SECRET; process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub"; process.env.VAPID_PRIVATE_KEY = "priv"; };

beforeEach(() => { rpc.mockReset(); sendNotification.mockReset(); setVapidDetails.mockReset(); env(); });
afterEach(() => { delete process.env.CRON_SECRET; delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; });

describe("push cron route", () => {
  it("is closed when anything is missing, or the token is wrong", async () => {
    delete process.env.VAPID_PRIVATE_KEY; expect((await call(SECRET)).status).toBe(503);
    env(); delete process.env.CRON_SECRET; expect((await call(SECRET)).status).toBe(503);
    env(); expect((await call()).status).toBe(401); expect((await call("nope-nope-nope-nope-nope!")).status).toBe(401);
    process.env.CRON_SECRET = "short"; expect((await call("short")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled(); expect(sendNotification).not.toHaveBeenCalled();
  });

  it("sends each device a short payload, removes dead devices, counts failures, and reports counts only", async () => {
    const sub = (id: string) => ({ id, endpoint: `https://push.example.com/${id}`, p256dh: "p".repeat(30), auth: "a".repeat(12) });
    rpc.mockImplementation(async (name: string) => name === "qb_push_pending"
      ? { data: [{ notification_id: "n1", title: "You won a prize", message: "You ranked 1.", link: "/play", subscriptions: [sub("s1"), sub("s2"), sub("s3")] },
                 { notification_id: "n2", title: "Evil", message: "x", link: "https://evil.example/x", subscriptions: [] }], error: null }
      : { data: { ok: true }, error: null });
    sendNotification.mockImplementation(async (s: { endpoint: string }) => {
      if (s.endpoint.endsWith("s2")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (s.endpoint.endsWith("s3")) throw Object.assign(new Error("busy"), { statusCode: 503 });
    });
    const res = await call(SECRET), body = await res.json();
    expect(res.status).toBe(200); expect(body).toEqual({ ok: true, notifications: 2, sent: 1, gone: 1, failed: 1 });
    expect(JSON.stringify(body)).not.toMatch(/push\.example|You won|ranked/);
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toEqual({ title: "You won a prize", body: "You ranked 1.", url: "/play", tag: "n1" });
    expect(rpc).toHaveBeenCalledWith("qb_push_report", { p_done: ["n1", "n2"], p_ok: ["s1"], p_gone: ["s2"], p_failed: ["s3"] });
  });

  it("only ever sends in-app links, and survives an empty queue or a read failure", async () => {
    rpc.mockResolvedValueOnce({ data: [{ notification_id: "n3", title: "t", message: "m", link: "https://evil.example/x", subscriptions: [{ id: "s9", endpoint: "https://p.example/9", p256dh: "p".repeat(30), auth: "a".repeat(12) }] }], error: null }).mockResolvedValue({ data: {}, error: null });
    await call(SECRET); expect(JSON.parse(sendNotification.mock.calls[0][1]).url).toBe("/");
    rpc.mockReset(); rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValue({ data: {}, error: null });
    expect(await (await call(SECRET)).json()).toEqual({ ok: true, notifications: 0, sent: 0, gone: 0, failed: 0 });
    rpc.mockReset(); rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await call(SECRET)).status).toBe(502);
  });
});
