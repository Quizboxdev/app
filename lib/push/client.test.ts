import { describe, expect, it } from "vitest";
import { urlBase64ToUint8Array } from "./client";

describe("urlBase64ToUint8Array", () => {
  it("decodes the URL-safe base64 a VAPID public key uses, with or without padding", () => {
    expect(Array.from(urlBase64ToUint8Array("SGVsbG8"))).toEqual([72, 101, 108, 108, 111]);          // "Hello"
    expect(Array.from(urlBase64ToUint8Array("SGVsbG8="))).toEqual([72, 101, 108, 108, 111]);
    expect(Array.from(urlBase64ToUint8Array("_-8"))).toEqual([255, 239]);                              // - and _ stand for + and /
  });
  it("gives 65 bytes for a real-length P-256 public key", () => {
    const key = Buffer.from(Array.from({ length: 65 }, (_, i) => i)).toString("base64url");
    expect(urlBase64ToUint8Array(key).length).toBe(65);
  });
});
