import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedRequest, sponsorError, sponsorRequestClient } from "./request-client";
afterEach(() => vi.unstubAllEnvs());
describe("sponsor HTTP boundary", () => {
  it("rejects production targets before any authentication or network request", async () => {
    vi.stubEnv("QUIZBOX_SPONSOR_ENGINE_ENABLED", "true"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fmgccmqxfjppqydkhaiu.supabase.co");
    await expect(sponsorRequestClient(new Request("http://localhost/api/sponsor/workspace"))).rejects.toThrow("SPONSOR_ENGINE_DISABLED");
  });
  it("requires authentication even on explicitly enabled loopback", async () => {
    vi.stubEnv("QUIZBOX_SPONSOR_ENGINE_ENABLED", "true"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    await expect(sponsorRequestClient(new Request("http://localhost/api/sponsor/workspace"))).rejects.toThrow("AUTH_REQUIRED");
  });
  it("does not leak database messages or provider details", async () => {
    const result = sponsorError(new Error("database connection private detail")); expect(await result.json()).toEqual({ error: "SPONSOR_REQUEST_FAILED" });
  });
  it("preserves specific authorization errors", async () => { const result = sponsorError(new Error("SPONSOR_ACCESS_DENIED")); expect(result.status).toBe(403); });
  it("bounds body consumption without trusting content length", async () => { await expect(boundedRequest(new Request("http://localhost", { method: "POST", body: "a".repeat(101) }), 100)).rejects.toThrow("REQUEST_TOO_LARGE"); });
  it("reads permitted bodies", async () => expect((await boundedRequest(new Request("http://localhost", { method: "POST", body: "{}" }), 100)).toString()).toBe("{}"));
});
