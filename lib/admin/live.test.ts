import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn(), older = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ rpc: (...a: unknown[]) => ({ abortSignal: () => rpc(...a) }) }) }));
vi.mock("@/lib/admin/dashboard", () => ({ getAdminDashboard: (days: number) => older(days) }));

const dash = { generated_at: new Date().toISOString(), days: 30, users: null, learning: null, content: null, markets: { ACTIVE: 1 }, schools: { listed: 4, waiting: 2 }, queues: { support_open: 3, support_waiting_for_user: 0, support_new_7d: 1 } };

describe("admin live figures client", () => {
  beforeEach(() => { vi.resetModules(); rpc.mockReset(); older.mockReset(); });

  it("returns the section with the time it was calculated on this device's clock", async () => {
    rpc.mockResolvedValue({ data: { data: { support_open: 5 }, age_seconds: 30, stale: false }, error: null });
    const { fetchLive } = await import("./live");
    const r = await fetchLive("queues", 30);
    expect(r.data).toEqual({ support_open: 5 });
    expect(Date.now() - r.asOf).toBeGreaterThanOrEqual(30_000);
    expect(r.basic).toBeUndefined();
    expect(older).not.toHaveBeenCalled();
  });

  it("falls back to one shared older call while the new function is not applied", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.qb_admin_live" } });
    older.mockResolvedValue(dash);
    const { fetchLive } = await import("./live");
    const [q, p, c] = await Promise.all([fetchLive("queues", 30), fetchLive("people", 30), fetchLive("content", 30)]);
    expect(older).toHaveBeenCalledTimes(1);
    expect(q).toMatchObject({ basic: true, data: { support_open: 3, schools_waiting: 2, markets_active: 1, markets_setting_up: 0 } });
    expect(p.data).toEqual({ users: null, learning: null, markets: { ACTIVE: 1 } });
    expect(c.data).toEqual({ content: null });
  });

  it("reports a failure in plain words and does not fall back for it", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    const { fetchLive } = await import("./live");
    await expect(fetchLive("content", 30)).rejects.toThrow("These figures could not be loaded.");
    expect(older).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "QB_FORBIDDEN" } });
    await expect(fetchLive("content", 30)).rejects.toThrow("Only staff can see the dashboard.");
  });
});
