import { describe, expect, it, vi, beforeEach } from "vitest";
import { errorDigest } from "./report";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server-admin", () => ({ getSupabaseAdminClient: () => ({ rpc }) }));

describe("client error reporting", () => {
  beforeEach(() => { vi.resetModules(); });
  it("gives the same digest for the same error and different digests for different errors", () => {
    expect(errorDigest(new Error("boom"))).toBe(errorDigest(new Error("boom")));
    expect(errorDigest(new Error("boom"))).not.toBe(errorDigest(new Error("other")));
    expect(errorDigest({ digest: "abc123" })).toBe(errorDigest({ digest: "abc123" }));
  });
  it("sends at most five distinct reports per page load, never the same error twice, and never throws", async () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal("window", { location: { pathname: "/practise" } });
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    vi.stubGlobal("Blob", class { constructor(public parts: unknown[]) {} });
    const { reportClientError } = await import("./report");
    reportClientError("RENDER", new Error("a")); reportClientError("RENDER", new Error("a"));
    for (let i = 0; i < 8; i++) reportClientError("UNHANDLED", new Error("e" + i));
    expect(beacon).toHaveBeenCalledTimes(5);
    vi.stubGlobal("navigator", { sendBeacon: () => { throw new Error("blocked"); } });
    expect(() => reportClientError("NETWORK", new Error("z"))).not.toThrow();
    vi.unstubAllGlobals();
  });
});

describe("client error route", () => {
  const post = async (body: unknown, origin = "https://www.quizbox.io") => {
    const { POST } = await import("../../app/api/ops/client-error/route");
    return POST(new Request("https://www.quizbox.io/api/ops/client-error", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { origin, host: "www.quizbox.io", "content-type": "application/json" } }));
  };
  it("records a good report, and answers 204 to everything so it cannot be probed", async () => {
    rpc.mockReset(); rpc.mockResolvedValue({ error: null });
    expect((await post({ kind: "RENDER", route: "/student", digest: "abc", message: "x" })).status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("qb_record_client_error", { p_kind: "RENDER", p_route: "/student", p_digest: "abc", p_message: "x" });
    rpc.mockReset();
    expect((await post({ kind: "RENDER" }, "https://evil.example")).status).toBe(204);
    expect((await post({ kind: "ROOT" })).status).toBe(204);
    expect((await post("not json")).status).toBe(204);
    expect((await post({ kind: "RENDER", message: "x".repeat(6000) })).status).toBe(204);
    expect(rpc).not.toHaveBeenCalled();
  });
});
