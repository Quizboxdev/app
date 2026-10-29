import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FLAGS, flagsFromSettings } from "@/lib/core/config";

const { rpc, setting } = vi.hoisted(() => ({ rpc: vi.fn(), setting: vi.fn() }));
vi.mock("@/lib/supabase/server-admin", () => ({ getSupabaseAdminClient: () => ({ rpc, from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ is: setting }) }) }) }) }) }));
import { getHelpCentreArticles, getPublicHelpArticle, helpCentreEnabled } from "./presentation";

describe("Canvas 11 Help data and flag boundaries", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it("defaults off and accepts only a boolean platform setting", async () => {
    expect(DEFAULT_FLAGS.design_v02_help).toBe(false);
    for (const value of [undefined, null, "true", 1, false]) {
      setting.mockResolvedValue({ data: [{ key: "flags.design_v02_help", value }], error: null });
      expect(await helpCentreEnabled()).toBe(false);
    }
    setting.mockResolvedValue({ data: [{ key: "flags.design_v02_help", value: true }], error: null });
    expect(await helpCentreEnabled()).toBe(true);
    expect(flagsFromSettings([]).design_v02_help).toBe(false);
  });
  it("fails closed on setting errors", async () => {
    setting.mockRejectedValue(new Error("offline"));
    expect(await helpCentreEnabled()).toBe(false);
    setting.mockResolvedValue({ data: [{ key: "flags.design_v02_help", value: true }], error: { message: "denied" } });
    expect(await helpCentreEnabled()).toBe(false);
  });
  it("distinguishes actual empty content from failures without fabricating articles", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await getHelpCentreArticles()).toEqual({ guides: [], unavailable: false });
    expect(rpc).toHaveBeenCalledWith("qb_help_list", { p_audience: null });
    rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    expect(await getHelpCentreArticles()).toEqual({ guides: [], unavailable: true });
    rpc.mockRejectedValue(new Error("offline"));
    expect(await getHelpCentreArticles()).toEqual({ guides: [], unavailable: true });
  });
  it("preserves missing article semantics without claiming unpublished status", async () => {
    expect(await getPublicHelpArticle("../../private")).toEqual({ status: "not-found" });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getPublicHelpArticle("missing-article")).toEqual({ status: "not-found" });
    expect(rpc).toHaveBeenCalledWith("qb_help_get", { p_slug: "missing-article" });
  });
  it("keeps RPC failures recoverable instead of turning them into a missing article", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    expect(await getPublicHelpArticle("test-article")).toEqual({ status: "error" });
    rpc.mockRejectedValue(new Error("offline"));
    expect(await getPublicHelpArticle("test-article")).toEqual({ status: "error" });
  });
});
