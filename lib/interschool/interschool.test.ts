import { describe, expect, it, vi } from "vitest";
import QRCode from "qrcode";
import { campaignLink, ghs, plain, problemText, sourceParam, sponsorshipFee, whatsappHref, whatsappMessage } from "./text";
import { draftKey, payload, restore, secondsLeft } from "./sitting";
import { csvCell, resultsCsv } from "./report";
import { blankRound, changes, cleanRound, copyRounds, fromInput, splitEqually, toInput } from "./wizard";
import { applyVerifiedPaymentEvent } from "@/lib/core/payments";
import { fulfilAfter } from "@/lib/payments/settlement";
import { confirmPayment } from "@/lib/payments/confirm";
import { DEFAULT_FLAGS } from "@/lib/core/config";
import type { Division, Settings } from "./types";
import { readFileSync, readdirSync } from "node:fs";

describe("plain words, money and campaign links", () => {
  it("never shows a database code", () => {
    expect(plain('error: IS_SCHOOL_ALLOCATION_FULL')).toBe("Your school has used all its places.");
    expect(plain("something odd")).toBe("That did not work. Please try again.");
    const sql = readdirSync("supabase/migrations").filter((f) => f.includes("interschool")).map((f) => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
    const codes = [...new Set(sql.match(/'(IS_[A-Z_]+)'/g)?.map((m) => m.slice(1, -1)) ?? [])].filter((c) => !c.endsWith("_"));
    expect(codes.filter((c) => plain(c) === "That did not work. Please try again.")).toEqual([]);
  });
  it("calculates a sponsorship as participants times the rate", () => {
    expect(sponsorshipFee(2000, 500)).toBe(1_000_000);
    expect(ghs(sponsorshipFee(2000, 500))).toBe("GHS 10,000.00");
    expect(sponsorshipFee(100, 500, 2000, 1000)).toBe(51_000);
  });
  it("tags campaign links by source and ignores anything else", () => {
    expect(campaignLink("https://www.quizbox.io/", "cup", "QR")).toBe("https://www.quizbox.io/inter-school/cup?src=qr");
    expect([sourceParam("whatsapp"), sourceParam("<x>"), sourceParam(undefined)]).toEqual(["WHATSAPP", "DIRECT", "DIRECT"]);
    const message = whatsappMessage("Cup", "https://x/y", "2026-12-01T12:00:00Z", "Gold Bank");
    expect(message).toContain("Sponsored by Gold Bank.");
    expect(decodeURIComponent(whatsappHref(message).split("text=")[1])).toBe(message);
  });
  it("makes a QR code for a campaign link", async () => {
    const svg = await QRCode.toString(campaignLink("https://www.quizbox.io", "cup", "QR"), { type: "svg" });
    expect(svg).toContain("<svg");
  });
  it("describes why a competition is not ready", () => {
    expect(problemText({ code: "IS_NOT_ENOUGH_QUESTIONS", division: "Basic 7", round: 2, sections: [{ subject_id: "s", subject: "Mathematics", need: 20, have: 4, ok: false, short: [] }] })).toContain("Basic 7, round 2: There are not enough approved questions for that choice. Mathematics: 4 available, 20 needed");
  });
});

describe("the player's saved work", () => {
  const questions = [{ id: "a", options: ["1", "2", "3", "4"], chosen: 1 }, { id: "b", options: ["1", "2"], chosen: null }];
  it("keeps what was answered offline over what the server holds, and ignores another sitting or damaged data", () => {
    const stored = JSON.stringify({ sitting: "s1", answers: { a: 2, b: 1, zzz: 0 } });
    expect(restore(questions, stored, "s1")).toEqual({ answers: { a: 2, b: 1 }, unsaved: { a: 2, b: 1 } });
    expect(restore(questions, stored, "other").answers).toEqual({ a: 1 });
    expect(restore(questions, "{broken", "s1").answers).toEqual({ a: 1 });
    expect(restore(questions, JSON.stringify({ sitting: "s1", answers: { b: 3 } }), "s1").unsaved).toEqual({});
    expect(payload({ a: 2 })).toEqual([{ question_id: "a", choice: 2 }]);
    expect(draftKey("s1")).toContain("s1");
  });
  it("counts down from the server's time, whatever the device clock says", () => {
    expect(secondsLeft("2026-01-01T10:10:00Z", "2026-01-01T10:00:00Z", 5_000, 65_000)).toBe(540);
    expect(secondsLeft("2026-01-01T10:10:00Z", "2026-01-01T10:00:00Z", 0, 9_999_000)).toBe(0);
  });
});

describe("the organiser's form", () => {
  it("reads and writes times as Ghana time", () => {
    expect(fromInput("2026-12-01T09:30")).toBe("2026-12-01T09:30:00.000Z");
    expect(toInput("2026-12-01T09:30:00+00:00")).toBe("2026-12-01T09:30");
  });
  it("sends only what changed", () => {
    const base = { title: "Cup", description: "", region: null, capacity: 100, opens_at: "2026-12-01T09:00:00+00:00" } as unknown as Settings;
    expect(changes(base, { ...base, opens_at: "2026-12-01T09:00:00.000Z" })).toEqual({});
    expect(changes(base, { ...base, capacity: 200, region: "" })).toEqual({ capacity: 200 });
  });
  it("splits questions equally and drops settings a rule does not use", () => {
    expect(splitEqually(10, ["a", "b", "c"]).map((s) => s.count)).toEqual([4, 3, 3]);
    const r = cleanRound({ ...blankRound(1, null, "2026-12-01T09:00:00Z"), rule: "ALL", pass_percent: 50, top_n: 3, frozen: true, sections: [{ subject_id: "a", count: 5, node_ids: [] }] });
    expect([r.pass_percent, r.top_n, "frozen" in r, "node_ids" in r.sections[0]]).toEqual([null, null, false, false]);
  });
  it("copies rounds to another level by subject name and reports gaps", () => {
    const subjects = [{ id: "m7", title: "Mathematics", level: "B7" }, { id: "m8", title: "Mathematics", level: "B8" }, { id: "e7", title: "English", level: "B7" }];
    const source = { level_codes: ["B7"], rounds: [{ ...blankRound(1, null, "2026-12-01T09:00:00Z"), sections: [{ subject_id: "m7", count: 5 }, { subject_id: "e7", count: 5 }] }] } as unknown as Division;
    const copy = copyRounds(source, subjects, { level_codes: ["B8"] } as Division);
    expect(copy.rounds[0].sections).toEqual([{ subject_id: "m8", count: 5 }]);
    expect(copy.missing).toEqual(["English"]);
  });
});

describe("sponsorship payments use their own database path", () => {
  const event = { provider: "paystack", eventId: "e1", reference: "QBS-0123456789abcdef", status: "successful" as const, amountMinor: 500, currency: "GHS" };
  it("applies a QBS payment to the invoice, never to the Coin ledger", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: "credited" }, error: null });
    await expect(applyVerifiedPaymentEvent({ rpc } as never, event)).resolves.toEqual({ outcome: "credited" });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["interschool_payment_apply"]);
    await expect(fulfilAfter({ rpc } as never, "credited", event.reference)).resolves.toEqual({ ok: true });
    await expect(fulfilAfter({ rpc } as never, "refunded", event.reference)).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("tells nobody else about a payment, and confirms the payer's own", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { payer_user_id: "u1", sponsor_user_id: "u1", status: "successful" }, error: null });
    await expect(confirmPayment({ rpc } as never, "sk", "someone-else", event.reference)).resolves.toEqual({ state: "unknown" });
    await expect(confirmPayment({ rpc } as never, "sk", "u1", event.reference)).resolves.toEqual({ state: "confirmed" });
    expect(rpc.mock.calls.every((c) => c[0] === "interschool_payment_status")).toBe(true);
  });
});

describe("switches", () => {
  it("are all off until the owner turns them on", () => {
    expect([DEFAULT_FLAGS.interschool, DEFAULT_FLAGS.interschool_public, DEFAULT_FLAGS.interschool_sponsorship, DEFAULT_FLAGS.interschool_certificates]).toEqual([false, false, false, false]);
  });
});

describe("results file", () => {
  it("quotes every cell and never lets a name run as a spreadsheet formula", () => {
    expect([csvCell('=cmd|"x"'), csvCell("-5"), csvCell(null)]).toEqual(['"\'=cmd|""x"""', '"-5"', '""']);
    const csv = resultsCsv({ finalised: true, competition: "Cup", schools: [{ institution_id: "1", school: "+School", rank: 1, score: 2, total_score: 2, present: 1, entered: 1, eligible: true, qualified: true }], learners: [] });
    expect(csv).toContain('"\'+School"');
    expect(csv).not.toContain("Learner rank");
  });
});
