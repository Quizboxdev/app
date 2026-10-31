import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SIGNATURE_TOLERANCE_SECONDS, decryptSecret, encryptSecret, hmacHex, safeEqual, sha256Hex, signCookie, signWebhook, verifyCookie, verifyWebhookSignature } from "./crypto";

const body = JSON.stringify({ id: "evt_1", type: "partner.seat.revoked", data: { external_ref: "a" } });
const now = 1_900_000_000;

describe("webhook signatures", () => {
  it("accepts a correct signature inside the window", () => {
    expect(verifyWebhookSignature(body, signWebhook("s3cret", body, now), ["s3cret"], now)).toEqual({ ok: true, timestamp: now });
    expect(verifyWebhookSignature(body, signWebhook("s3cret", body, now - 299), ["s3cret"], now).ok).toBe(true);
  });
  it("rejects a stale or future timestamp (replay)", () => {
    expect(verifyWebhookSignature(body, signWebhook("s3cret", body, now - SIGNATURE_TOLERANCE_SECONDS - 1), ["s3cret"], now)).toEqual({ ok: false, reason: "stale" });
    expect(verifyWebhookSignature(body, signWebhook("s3cret", body, now + 400), ["s3cret"], now)).toEqual({ ok: false, reason: "stale" });
  });
  it("rejects a changed body, a wrong secret and a re-used signature on another body", () => {
    const h = signWebhook("s3cret", body, now);
    expect(verifyWebhookSignature(body + " ", h, ["s3cret"], now)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyWebhookSignature(body, h, ["other"], now)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyWebhookSignature("{}", h, ["s3cret"], now).ok).toBe(false);
  });
  it("accepts either secret during a rotation and refuses malformed headers", () => {
    const h = signWebhook("old", body, now);
    expect(verifyWebhookSignature(body, h, ["new", "old"], now).ok).toBe(true);
    for (const bad of [null, "", "garbage", "t=abc,v1=" + "a".repeat(64), "t=1900000000", "t=1900000000,v1=short", `t=${now},v1=${"a".repeat(64)},v1=${"b".repeat(64)},v1=${"c".repeat(64)},v1=${"d".repeat(64)},v1=${"e".repeat(64)}`]) {
      expect(verifyWebhookSignature(body, bad as any, ["old"], now).ok).toBe(false);
    }
    expect(verifyWebhookSignature(body, signWebhook("old", body, now), [], now).ok).toBe(false);
  });
  it("compares in constant time helpers correctly", () => {
    expect(safeEqual("abc", "abc")).toBe(true); expect(safeEqual("abc", "abd")).toBe(false); expect(safeEqual("abc", "abcd")).toBe(false);
    expect(sha256Hex("a")).toBe("ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
    expect(hmacHex("k", "d")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("stored secrets and the sign-in cookie", () => {
  const key = randomBytes(32);
  it("encrypts and decrypts, with a different ciphertext every time, and refuses tampering or another key", () => {
    const a = encryptSecret("whsec_abc", key), b = encryptSecret("whsec_abc", key);
    expect(a).not.toBe(b); expect(a).not.toContain("whsec_abc"); expect(a.length).toBeGreaterThan(20);
    expect(decryptSecret(a, key)).toBe("whsec_abc");
    const [v, iv, tag, ct] = a.replace("v1:", "v1:.").split(".").slice(0);
    expect(() => decryptSecret(a.slice(0, -2) + "AA", key)).toThrow();
    expect(() => decryptSecret(a, randomBytes(32))).toThrow();
    expect(() => decryptSecret("plain text", key)).toThrow();
    void v; void iv; void tag; void ct;
  });
  it("requires a 32 byte key", async () => {
    const { secretsKey } = await import("./crypto");
    expect(() => secretsKey({})).toThrow(); expect(() => secretsKey({ PARTNER_SECRETS_KEY: Buffer.from("short").toString("base64") })).toThrow();
    expect(secretsKey({ PARTNER_SECRETS_KEY: key.toString("base64") }).length).toBe(32);
  });
  it("signs a cookie that cannot be altered or forged", () => {
    const c = signCookie({ slug: "x", state: "s" }, key);
    expect(verifyCookie(c, key)).toEqual({ slug: "x", state: "s" });
    expect(verifyCookie(c.replace(/^./, "Z"), key)).toBeNull();
    expect(verifyCookie(c, randomBytes(32))).toBeNull();
    expect(verifyCookie("nope", key)).toBeNull(); expect(verifyCookie(undefined, key)).toBeNull(); expect(verifyCookie("x".repeat(3000), key)).toBeNull();
    const [body] = c.split(".");
    expect(verifyCookie(`${Buffer.from('{"slug":"evil"}').toString("base64url")}.${c.split(".")[1]}`, key)).toBeNull();
    void body;
  });
});
