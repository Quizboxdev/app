import { beforeEach, describe, expect, it, vi } from "vitest";

// PDF reading limits (audit QB-AUD-014): too many pages and too slow are refused with short codes, and the parser is always released.
let pages = 3, delayMs = 0, destroyed = 0;
vi.mock("pdf-parse/worker", () => ({ getData: () => "worker", CanvasFactory: class {} }));
vi.mock("pdf-parse", () => ({
  PDFParse: class {
    static setWorker() { /* the real one installs the inline worker */ }
    async getInfo() { return { total: pages }; }
    async getText() { if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); return { pages: Array.from({ length: Math.min(pages, 3) }, (_, i) => ({ num: i + 1, text: `page ${i + 1}` })) }; }
    async destroy() { destroyed += 1; }
  },
}));
import { pdfPages, PDF_LIMITS } from "./pdf";

beforeEach(() => { pages = 3; delayMs = 0; destroyed = 0; });

describe("pdfPages limits", () => {
  it("reads an ordinary PDF and releases the parser", async () => {
    expect(await pdfPages(new Uint8Array([1]))).toEqual([{ num: 1, text: "page 1" }, { num: 2, text: "page 2" }, { num: 3, text: "page 3" }]);
    expect(destroyed).toBe(1);
  });
  it("refuses a PDF with too many pages before reading any text", async () => {
    pages = PDF_LIMITS.maxPages + 1;
    await expect(pdfPages(new Uint8Array([1]))).rejects.toThrow("PDF_TOO_LONG");
    expect(destroyed).toBe(1);
    pages = PDF_LIMITS.maxPages;
    await expect(pdfPages(new Uint8Array([1]))).resolves.toHaveLength(3);                                 // exactly at the limit is fine
  });
  it("gives up on a PDF that takes too long, with a short code, and still releases the parser", async () => {
    delayMs = 200;
    await expect(pdfPages(new Uint8Array([1]), { maxPages: 400, maxMillis: 30 })).rejects.toThrow("PDF_TIMEOUT");
    expect(destroyed).toBe(1);
  });
});
