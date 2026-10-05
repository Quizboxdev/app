import { describe, expect, it, vi } from "vitest";
import { QUIZBOX_PROVENANCE_NAMESPACE, QUIZBOX_PROVENANCE_TOKENS } from "@/lib/provenance";
import { classifyProficiency } from "@/lib/learning/proficiency";
import { DEFAULT_FLAGS, classifyByBands, flagsFromSettings, legacyMasteryStrategy, parseBands } from "./config";
import { coinsToMinor, handlePaymentWebhook, registerPaymentProvider, type PaymentProvider } from "./payments";
import { canAccess, homeRouteForWorkspace } from "./roles";

describe("roles and workspace helpers", () => {
  it("routes by remembered workspace only while the role is still held", () => {
    expect(homeRouteForWorkspace(["student", "teacher"], "teacher")).toBe("/teacher");
    expect(homeRouteForWorkspace(["student"], "teacher")).toBe("/student");
    expect(homeRouteForWorkspace(["school_admin", "student"])).toBe("/school");
    expect(homeRouteForWorkspace([])).toBe("/student");
  });
  it("platform staff pass every guard; others need an allowed role", () => {
    expect(canAccess(["super_admin"], ["teacher"])).toBe(true);
    expect(canAccess(["student"], ["teacher"])).toBe(false);
    expect(canAccess(["parent_guardian"], ["parent_guardian"])).toBe(true);
  });
});

describe("configuration", () => {
  it("fails closed and ignores unknown or non-boolean flags", () => {
    expect(flagsFromSettings([{ key: "flags.buy_coins_enabled", value: true }, { key: "flags.nope", value: true }, { key: "flags.paid_challenges", value: "yes" }]))
      .toEqual({ ...DEFAULT_FLAGS, buy_coins_enabled: true });
  });
  it("keeps the existing Ghana CCP classification at every boundary and honours custom bands", () => {
    const expected: Array<[number, string]> = [[100, "Highly Proficient"], [80, "Highly Proficient"], [79.9, "Proficient"], [68, "Proficient"], [67, "Approaching Proficiency"], [54, "Approaching Proficiency"], [53, "Developing"], [40, "Developing"], [39, "Emerging"], [0, "Emerging"], [Number.NaN, "Emerging"]];
    for (const [pct, label] of expected) expect(classifyProficiency(pct)).toBe(label);
    const custom = parseBands({ bands: [{ code: "pass", label: "Pass", min: 50 }, { code: "fail", label: "Fail", min: 0 }] });
    expect(classifyByBands(50, custom).label).toBe("Pass");
    expect(classifyByBands(49, custom).label).toBe("Fail");
    expect(parseBands({ bands: [{ code: "x", label: "X", min: 10 }] })[0].label).toBe("Highly Proficient"); // no floor band -> safe default
  });
  it("maps legacy mastery output onto QuizBox mastery states behind the strategy interface", () => {
    expect(legacyMasteryStrategy.evaluate({ recentAccuracy: 0, historicalAccuracy: 0, difficultyAdjustedPerformance: 0, consistency: 0, independence: 0, attemptsCount: 0 }).state).toBe("not_started");
  });
});

describe("payment webhook boundary", () => {
  const admin = { rpc: vi.fn(async () => ({ data: { outcome: "credited" }, error: null })) } as any;
  const provider = (event: unknown): PaymentProvider => ({ code: "p1", verifyWebhook: async () => event as any });
  it("changes nothing for unknown providers or unverifiable callbacks", async () => {
    expect(await handlePaymentWebhook(admin, "missing", "{}", new Headers())).toEqual({ status: 404 });
    registerPaymentProvider(provider(null));
    expect(await handlePaymentWebhook(admin, "p1", "{}", new Headers())).toEqual({ status: 400 });
    registerPaymentProvider(provider({ provider: "other", eventId: "e", reference: "r", status: "successful", amountMinor: 1, currency: "GHS" }));
    expect(await handlePaymentWebhook(admin, "p1", "{}", new Headers())).toEqual({ status: 400 });
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it("forwards only verified events to the ledger RPC", async () => {
    registerPaymentProvider(provider({ provider: "p1", eventId: "e1", reference: "QB-1", status: "successful", amountMinor: 1000, currency: "GHS" }));
    expect(await handlePaymentWebhook(admin, "p1", "{}", new Headers())).toEqual({ status: 200, outcome: "credited" });
    expect(admin.rpc).toHaveBeenCalledWith("qb_payment_apply_event", expect.objectContaining({ p_verified: true, p_reference: "QB-1" }));
  });
  it("rejects non-integer or non-positive coin maths", () => {
    expect(coinsToMinor(10, 100)).toBe(1000);
    for (const bad of [0, -1, 1.5]) expect(() => coinsToMinor(bad, 100)).toThrow("QB_INVALID_AMOUNT");
  });
});

describe("provenance marker", () => {
  it("embeds the three signature tokens in the internal namespace", () => {
    expect(QUIZBOX_PROVENANCE_NAMESPACE).toBe("quizbox.ransford.eddy.mensah");
    expect(QUIZBOX_PROVENANCE_TOKENS.map((t) => t.toLowerCase())).toEqual(QUIZBOX_PROVENANCE_NAMESPACE.split(".").slice(1));
  });
});
