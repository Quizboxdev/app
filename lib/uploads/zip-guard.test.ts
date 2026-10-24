import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { assertSafeZip, ZIP_LIMITS } from "./zip-guard";

// Real zip files built by JSZip, so the guard is tested against genuine central directories.
const build = async (files: Record<string, string | Uint8Array>) => { const z = new JSZip(); for (const [n, c] of Object.entries(files)) z.file(n, c); return z.generateAsync({ type: "uint8array", compression: "DEFLATE" }); };

describe("assertSafeZip", () => {
  it("accepts an ordinary document and reports what is inside", async () => {
    const zip = await build({ "[Content_Types].xml": "<x/>", "word/document.xml": "<w:document>" + "hello ".repeat(5000) + "</w:document>", "word/styles.xml": "<s/>" });
    expect(assertSafeZip(zip).entries).toBeGreaterThanOrEqual(3);                              // folder entries are counted too
    expect(assertSafeZip(zip).totalBytes).toBeGreaterThan(30000);
  });
  it("accepts a zip that has a comment after its table of contents", async () => {
    const z = new JSZip(); z.file("a.txt", "hi");
    expect(assertSafeZip(await z.generateAsync({ type: "uint8array", comment: "a comment that sits after the table of contents" })).entries).toBe(1);
  });
  it("refuses a file that is not a zip, is too short, or is cut off", async () => {
    for (const bad of [new Uint8Array(0), new Uint8Array([1, 2, 3]), new TextEncoder().encode("PK but not really a zip file at all, just text"), (await build({ "a.txt": "x" })).slice(0, 30)]) expect(() => assertSafeZip(bad)).toThrow("NOT_A_ZIP");
  });
  it("refuses a zip bomb: a small upload that would expand to gigabytes", async () => {
    const bomb = await build({ "word/document.xml": new Uint8Array(64 * 1024 * 1024) });         // 64 MB of zeros squeezes to about 64 KB
    expect(bomb.length).toBeLessThan(200 * 1024);
    expect(() => assertSafeZip(bomb)).toThrow(/ZIP_SUSPICIOUS|ZIP_TOO_LARGE/);
  });
  it("refuses too many entries, too much in total, and one entry that is too big", async () => {
    const many: Record<string, string> = {}; for (let i = 0; i < 30; i++) many[`f${i}.txt`] = "x";
    const zip = await build(many);
    expect(() => assertSafeZip(zip, { ...ZIP_LIMITS, maxEntries: 20 })).toThrow("ZIP_TOO_LARGE");
    expect(() => assertSafeZip(zip, ZIP_LIMITS)).not.toThrow();
    const big = await build({ "a.bin": new Uint8Array(3000).map((_, i) => i * 7), "b.bin": new Uint8Array(3000).map((_, i) => i * 13) });
    expect(() => assertSafeZip(big, { ...ZIP_LIMITS, maxTotalBytes: 4000 })).toThrow("ZIP_TOO_LARGE");
    expect(() => assertSafeZip(big, { ...ZIP_LIMITS, maxEntryBytes: 2000 })).toThrow("ZIP_TOO_LARGE");
  });
  it("lets a normal document with large but ordinary content through", async () => {
    const text = Array.from({ length: 200000 }, (_, i) => `word${i % 997}`).join(" ");              // about 1.7 MB of varied text
    const zip = await build({ "word/document.xml": text });
    expect(() => assertSafeZip(zip)).not.toThrow();
  });
});
