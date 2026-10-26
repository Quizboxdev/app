import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Cryptographic helpers for the Partner Access Gateway. Everything compares in constant time and nothing here logs a secret.
export const SIGNATURE_TOLERANCE_SECONDS = 300;
export const MAX_EVENT_BYTES = 16 * 1024;

export const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
export const hmacHex = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Inbound partner events are signed as HMAC-SHA256(secret, `${t}.${rawBody}`) and sent as `t=<unix seconds>,v1=<hex>`. More than one v1 may be present during a secret rotation.
export type SignatureResult = { ok: true; timestamp: number } | { ok: false; reason: "missing" | "format" | "stale" | "mismatch" };
export function verifyWebhookSignature(raw: string, header: string | null, secrets: string[], nowSeconds = Math.floor(Date.now() / 1000)): SignatureResult {
  if (!header) return { ok: false, reason: "missing" };
  let t = NaN; const sigs: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("="); if (i < 1) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === "t") t = /^\d{1,12}$/.test(v) ? Number(v) : NaN; else if (k === "v1" && /^[0-9a-f]{64}$/.test(v)) sigs.push(v);
  }
  if (!Number.isFinite(t) || sigs.length === 0 || sigs.length > 4) return { ok: false, reason: "format" };
  if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "stale" };
  const signed = `${t}.${raw}`;
  let match = false;                                          // check every secret and every signature so timing does not reveal which matched
  for (const secret of secrets) { const expected = hmacHex(secret, signed); for (const s of sigs) if (safeEqual(expected, s)) match = true; }
  return match ? { ok: true, timestamp: t } : { ok: false, reason: "mismatch" };
}
export const signWebhook = (secret: string, raw: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${hmacHex(secret, `${t}.${raw}`)}`;

// Secrets that must be read back (webhook secrets, OIDC client secrets) are stored as AES-256-GCM ciphertext; the key lives only in the server environment (PARTNER_SECRETS_KEY, 32 bytes, base64).
export function secretsKey(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env.PARTNER_SECRETS_KEY;
  const key = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (key.length !== 32) throw new Error("PARTNER_SECRETS_KEY must be 32 bytes, base64 encoded.");
  return key;
}
export function encryptSecret(plain: string, key: Buffer = secretsKey()): string {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
}
export function decryptSecret(enc: string, key: Buffer = secretsKey()): string {
  const m = /^v1:([\w-]+)\.([\w-]+)\.([\w-]+)$/.exec(enc);
  if (!m) throw new Error("Unsupported secret format.");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(m[1], "base64url"));
  d.setAuthTag(Buffer.from(m[2], "base64url"));
  return Buffer.concat([d.update(Buffer.from(m[3], "base64url")), d.final()]).toString("utf8");
}

// Short-lived signed cookie for the sign-in round trip (state, nonce and the PKCE verifier). The key is derived from PARTNER_SECRETS_KEY so one variable covers both.
const cookieKey = (key: Buffer) => createHmac("sha256", key).update("qb-partner-sso-cookie-v1").digest("hex");
export function signCookie(payload: object, key: Buffer = secretsKey()): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmacHex(cookieKey(key), body)}`;
}
export function verifyCookie<T = Record<string, unknown>>(value: string | undefined | null, key: Buffer = secretsKey()): T | null {
  if (!value || value.length > 2000) return null;
  const i = value.lastIndexOf("."); if (i < 1) return null;
  const body = value.slice(0, i), sig = value.slice(i + 1);
  if (!safeEqual(hmacHex(cookieKey(key), body), sig)) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T; } catch { return null; }
}
