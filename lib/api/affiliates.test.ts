import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ rpc: rpcMock }) }));

describe("affiliates client", () => {
  beforeEach(() => { rpcMock.mockReset(); });
  it("builds the share link from the site address", async () => {
    const { shareLink } = await import("./affiliates");
    expect(shareLink("https://www.quizbox.io/", "AB12CD34")).toBe("https://www.quizbox.io/r/AB12CD34");
  });
  it("turns database refusals into plain sentences, never raw codes", async () => {
    const { affiliateApply, adminDecide, policyApprove } = await import("./affiliates");
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "QB_ADULTS_ONLY" } });
    await expect(affiliateApply({ display_name: "A B", phone: "0244000000", adult: true, accept_terms: true })).rejects.toThrow("The affiliate programme is for adults. Children and school-managed learners cannot join.");
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "QB_IDENTITY_CHECK_REQUIRED" } });
    await expect(adminDecide("id", "approve", "", false)).rejects.toThrow(/identity/i);
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "QB_SECOND_APPROVER_REQUIRED" } });
    await expect(policyApprove("id")).rejects.toThrow("A different person must approve this policy.");
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "something internal blew up: relation x does not exist" } });
    await expect(policyApprove("id")).rejects.toThrow("That did not work. Please try again.");
  });
  it("sends the decision exactly as the database function expects", async () => {
    const { adminDecide, referralCapture } = await import("./affiliates");
    rpcMock.mockResolvedValue({ data: { id: "x", status: "approved" }, error: null });
    await adminDecide("aff-1", "approve", "", true);
    expect(rpcMock).toHaveBeenCalledWith("qb_affiliate_decide", { p_id: "aff-1", p_action: "approve", p_note: "", p_identity_verified: true });
    await referralCapture("AB12CD34");
    expect(rpcMock).toHaveBeenCalledWith("qb_referral_capture", { p_code: "AB12CD34", p_source: "link", p_campaign: "" });
  });
});
