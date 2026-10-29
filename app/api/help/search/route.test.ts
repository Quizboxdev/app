import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server-admin", () => ({ getSupabaseAdminClient: () => ({ rpc }) }));
import { GET } from "./route";

describe("Help search cache and audience contract", () => {
  beforeEach(() => vi.resetAllMocks());
  it("keeps successful published-search caching and the existing audience argument", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const response = await GET(new Request("http://localhost/api/help/search?q=teacher&audience=teacher"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=30");
    expect(rpc).toHaveBeenCalledWith("qb_help_search", { p_query: "teacher", p_audience: "teacher" });
  });
  it("does not cache a failure that would prevent immediate retry recovery", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
      const response = await GET(new Request("http://localhost/api/help/search?q=teacher"));
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ ok: false, results: [] });
    } finally { log.mockRestore(); }
  });
});
