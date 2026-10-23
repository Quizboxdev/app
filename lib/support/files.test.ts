import { describe, expect, it } from "vitest";
import { checkFile, displayName, MAX_FILE_BYTES, sniffMime } from "./files";

const bytes = (head: number[], total = 64) => { const b = new Uint8Array(total); b.set(head); return b; };
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34], JPG = [0xff, 0xd8, 0xff, 0xe0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];

describe("support attachments", () => {
  it("recognises PNG, JPEG, WebP and PDF by their content", () => {
    expect(sniffMime(bytes(PNG))).toBe("image/png"); expect(sniffMime(bytes(JPG))).toBe("image/jpeg"); expect(sniffMime(bytes(WEBP))).toBe("image/webp"); expect(sniffMime(bytes(PDF))).toBe("application/pdf");
  });
  it("refuses anything else, however it is named: programs, scripts, HTML, SVG, Office files, a RIFF file that is not WebP", () => {
    const text = (s: string) => new TextEncoder().encode(s.padEnd(64, " "));
    for (const evil of [bytes([0x4d, 0x5a, 0x90, 0x00]), text("#!/bin/sh\nrm -rf /"), text("<html><script>alert(1)</script></html>"), text('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), bytes([0x50, 0x4b, 0x03, 0x04]), bytes([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45])]) {
      expect(checkFile(evil)).toEqual({ ok: false, code: "BAD_TYPE" });
    }
  });
  it("checks size and emptiness", () => {
    expect(checkFile(new Uint8Array(0))).toEqual({ ok: false, code: "EMPTY" });
    expect(checkFile(bytes(PNG, MAX_FILE_BYTES + 1))).toEqual({ ok: false, code: "TOO_BIG" });
    expect(checkFile(bytes(PNG, MAX_FILE_BYTES))).toEqual({ ok: true, mime: "image/png", ext: "png" });
  });
  it("cleans the name shown to people", () => {
    expect(displayName("..\\evil/../receipt\u0007.pdf", "pdf")).toBe(".._evil_.._receipt.pdf");
    expect(displayName("   ", "png")).toBe("attachment.png");
    expect(displayName("screenshot", "jpg")).toBe("screenshot.jpg");
    expect(displayName("a".repeat(300) + ".png", "png").length).toBeLessThanOrEqual(124);
  });
});
