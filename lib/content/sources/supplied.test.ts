import { describe, expect, it } from "vitest";
import { acceptSuppliedPdf } from "./supplied";

const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 1)]);
const text = "Common Core Programme curriculum text ".repeat(20);
const claim = { id: "11111111-1111-4111-8111-111111111111", token: "tok", title: "Social Studies CCP", market_id: "22222222-2222-4222-8222-222222222222" };

function harness(over: { claimError?: string; storeError?: string; finishError?: string } = {}) {
  const calls: Array<{ name: string; args: any }> = []; const stored: string[] = [];
  const rpc = (async (name: string, args: any) => {
    calls.push({ name, args });
    if (name === "qb_source_claim_file") { if (over.claimError) throw new Error(over.claimError); return claim; }
    if (args.p_action === "finish_fetch") { if (over.finishError) throw new Error(over.finishError); return { status: "NEEDS_REVIEW" }; }
    return {};
  }) as never;
  const store = async (path: string) => { if (over.storeError) throw new Error(over.storeError); stored.push(path); };
  return { calls, stored, rpc, store };
}

describe("administrator-supplied source file", () => {
  it("claims the row, stores the file and records it for review, with its fingerprint and page count", async () => {
    const h = harness();
    const out = await acceptSuppliedPdf(h.rpc, h.store, claim.id, pdf, async () => ({ text, pages: 158 }));
    expect(out).toMatchObject({ id: claim.id, status: "NEEDS_REVIEW", pages: 158 });
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(h.calls.map((c) => c.args.p_action ?? c.name)).toEqual(["qb_source_claim_file", "finish_fetch"]);
    const finish = h.calls[1].args.p_data;
    expect(finish).toMatchObject({ id: claim.id, token: "tok", sha256: out.sha256, bytes: pdf.length, pages: 158 });
    expect(finish.storage_path).toMatch(new RegExp(`^${claim.market_id}/[0-9a-f-]{36}\\.pdf$`));
    expect(h.stored).toEqual([finish.storage_path]);
  });

  it("records a file the browser already placed in the bucket under that same path, without storing it again", async () => {
    const h = harness();
    const path = `${claim.market_id}/33333333-3333-4333-8333-333333333333.pdf`;
    const out = await acceptSuppliedPdf(h.rpc, h.store, claim.id, pdf, async () => ({ text, pages: 259 }), { storedPath: path });
    expect(out).toMatchObject({ status: "NEEDS_REVIEW", pages: 259 });
    expect(h.stored).toEqual([]);
    expect(h.calls[1].args.p_data.storage_path).toBe(path);
  });

  it("rejects anything that is not a readable PDF before the registry is touched", async () => {
    for (const [bytes, extract, code] of [
      [Buffer.from("<html>not a pdf</html>"), async () => ({ text, pages: 1 }), "NOT_A_PDF"],
      [Buffer.alloc(0), async () => ({ text, pages: 1 }), "EMPTY_REQUEST"],
      [pdf, async () => ({ text: "scan only", pages: 3 }), "EXTRACTION_EMPTY"],
    ] as const) {
      const h = harness();
      await expect(acceptSuppliedPdf(h.rpc, h.store, claim.id, bytes as Buffer, extract as never)).rejects.toThrow(code);
      expect(h.calls).toEqual([]);
    }
  });

  it("releases the claim with the reason when storing or recording fails, and records nothing", async () => {
    const stored = harness({ storeError: "SOURCE_STORAGE_FAILED" });
    await expect(acceptSuppliedPdf(stored.rpc, stored.store, claim.id, pdf, async () => ({ text, pages: 2 }))).rejects.toThrow("SOURCE_STORAGE_FAILED");
    expect(stored.calls.map((c) => c.args.p_action ?? c.name)).toEqual(["qb_source_claim_file", "fail_fetch"]);
    expect(stored.calls[1].args.p_data).toMatchObject({ id: claim.id, token: "tok", error_code: "SOURCE_STORAGE_FAILED" });
    const finished = harness({ finishError: "QB_SOURCE_CLAIM_INVALID" });
    await expect(acceptSuppliedPdf(finished.rpc, finished.store, claim.id, pdf, async () => ({ text, pages: 2 }))).rejects.toThrow("QB_SOURCE_CLAIM_INVALID");
  });

  it("surfaces a refusal to claim (not a super admin, wrong state) without storing anything", async () => {
    const h = harness({ claimError: "QB_SOURCE_INVALID_TRANSITION" });
    await expect(acceptSuppliedPdf(h.rpc, h.store, claim.id, pdf, async () => ({ text, pages: 2 }))).rejects.toThrow("QB_SOURCE_INVALID_TRANSITION");
    expect(h.stored).toEqual([]);
  });
});
