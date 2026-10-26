import { createHash, createPublicKey, createVerify, randomBytes, verify as cryptoVerify, type JsonWebKey } from "node:crypto";

// OpenID Connect (authorization code + PKCE) for partner sign-in. A redirect, an e-mail address or a query-string id is never proof of who someone is: only a signed ID token that passes EVERY check below is.
export type OidcConfig = {
  partner_id: string; name: string; issuer: string; audience: string; jwks_uri: string; authorization_endpoint: string; token_endpoint: string;
  client_secret_enc: string | null; allowed_domains: string[]; auto_provision: boolean;
};
export type IdClaims = { iss: string; sub: string; aud: string | string[]; exp: number; iat?: number; nbf?: number; nonce?: string; azp?: string; email?: string; email_verified?: boolean | string; name?: string; [k: string]: unknown };
export class OidcError extends Error { constructor(public code: string) { super(code); } }

const ALGS = new Set(["RS256", "ES256"]);              // no "none", no HMAC (a public key must never be usable as a shared secret)
const SKEW = 60, MAX_TOKEN = 8 * 1024, MAX_JWKS = 100 * 1024, FETCH_TIMEOUT_MS = 5000;

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}
export const randomState = () => randomBytes(24).toString("base64url");

export function buildAuthorizationUrl(cfg: Pick<OidcConfig, "authorization_endpoint" | "audience">, p: { redirectUri: string; state: string; nonce: string; challenge: string }): string {
  const u = new URL(cfg.authorization_endpoint);
  if (u.protocol !== "https:") throw new OidcError("OIDC_ENDPOINT_NOT_HTTPS");
  u.searchParams.set("response_type", "code"); u.searchParams.set("client_id", cfg.audience); u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("scope", "openid email profile"); u.searchParams.set("state", p.state); u.searchParams.set("nonce", p.nonce);
  u.searchParams.set("code_challenge", p.challenge); u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

type Jwk = JsonWebKey & { kid?: string; use?: string; alg?: string };
const jwksCache = new Map<string, { at: number; keys: Jwk[] }>();
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function limitedJson(res: Response, max: number): Promise<any> {
  const text = await res.text();
  if (text.length > max) throw new OidcError("OIDC_RESPONSE_TOO_LARGE");
  return JSON.parse(text);
}
export async function fetchJwks(uri: string, f: FetchLike = fetch, now = Date.now()): Promise<Jwk[]> {
  if (!uri.startsWith("https://")) throw new OidcError("OIDC_ENDPOINT_NOT_HTTPS");
  const hit = jwksCache.get(uri);
  if (hit && now - hit.at < 5 * 60_000) return hit.keys;
  const res = await f(uri, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "error", headers: { accept: "application/json" } });
  if (!res.ok) throw new OidcError("OIDC_JWKS_UNAVAILABLE");
  const json = await limitedJson(res, MAX_JWKS);
  const keys = Array.isArray(json?.keys) ? (json.keys as Jwk[]) : [];
  jwksCache.set(uri, { at: now, keys });
  return keys;
}
export const clearJwksCache = () => jwksCache.clear();

export async function exchangeCode(cfg: Pick<OidcConfig, "token_endpoint" | "audience">, p: { code: string; verifier: string; redirectUri: string; clientSecret?: string }, f: FetchLike = fetch): Promise<string> {
  if (!cfg.token_endpoint.startsWith("https://")) throw new OidcError("OIDC_ENDPOINT_NOT_HTTPS");
  const body = new URLSearchParams({ grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, client_id: cfg.audience, code_verifier: p.verifier });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (p.clientSecret) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(cfg.audience)}:${encodeURIComponent(p.clientSecret)}`).toString("base64")}`;
  const res = await f(cfg.token_endpoint, { method: "POST", body, headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "error" });
  if (!res.ok) throw new OidcError("OIDC_TOKEN_EXCHANGE_FAILED");
  const json = await limitedJson(res, MAX_JWKS);
  if (typeof json?.id_token !== "string") throw new OidcError("OIDC_NO_ID_TOKEN");
  return json.id_token;
}

const b64json = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

// Verifies signature, issuer, audience, authorized party, expiry, not-before, issued-at, nonce and subject. Anything unexpected throws OidcError.
export async function verifyIdToken(idToken: string, cfg: Pick<OidcConfig, "issuer" | "audience" | "jwks_uri">, expect: { nonce: string; nowSeconds?: number; fetchJwks?: (uri: string) => Promise<Jwk[]> }): Promise<IdClaims> {
  if (idToken.length > MAX_TOKEN) throw new OidcError("OIDC_TOKEN_INVALID");
  const parts = idToken.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[\w-]+$/.test(p))) throw new OidcError("OIDC_TOKEN_INVALID");
  let header: { alg?: string; kid?: string }, claims: IdClaims;
  try { header = b64json(parts[0]); claims = b64json(parts[1]); } catch { throw new OidcError("OIDC_TOKEN_INVALID"); }
  if (!header.alg || !ALGS.has(header.alg)) throw new OidcError("OIDC_ALG_NOT_ALLOWED");
  const keys = await (expect.fetchJwks ?? ((u: string) => fetchJwks(u)))(cfg.jwks_uri);
  const wantKty = header.alg === "RS256" ? "RSA" : "EC";
  const candidates = keys.filter((k) => k.kty === wantKty && (k.use === undefined || k.use === "sig") && (k.alg === undefined || k.alg === header.alg) && (header.kid ? k.kid === header.kid : true) && (header.alg !== "ES256" || k.crv === "P-256"));
  if (candidates.length === 0 || (!header.kid && candidates.length > 1)) throw new OidcError("OIDC_KEY_NOT_FOUND");
  const data = Buffer.from(`${parts[0]}.${parts[1]}`), sig = Buffer.from(parts[2], "base64url");
  let valid = false;
  try {
    const key = createPublicKey({ key: candidates[0], format: "jwk" });
    valid = header.alg === "RS256" ? createVerify("RSA-SHA256").update(data).verify(key, sig) : cryptoVerify("sha256", data, { key, dsaEncoding: "ieee-p1363" }, sig);
  } catch { valid = false; }
  if (!valid) throw new OidcError("OIDC_SIGNATURE_INVALID");

  const now = expect.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (claims.iss !== cfg.issuer) throw new OidcError("OIDC_ISSUER_MISMATCH");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(cfg.audience)) throw new OidcError("OIDC_AUDIENCE_MISMATCH");
  if (aud.length > 1 && claims.azp !== cfg.audience) throw new OidcError("OIDC_AZP_MISMATCH");
  if (typeof claims.exp !== "number" || claims.exp <= now - SKEW) throw new OidcError("OIDC_TOKEN_EXPIRED");
  if (typeof claims.nbf === "number" && claims.nbf > now + SKEW) throw new OidcError("OIDC_TOKEN_NOT_YET_VALID");
  if (typeof claims.iat === "number" && claims.iat > now + 300) throw new OidcError("OIDC_TOKEN_NOT_YET_VALID");
  if (!expect.nonce || claims.nonce !== expect.nonce) throw new OidcError("OIDC_NONCE_MISMATCH");
  if (typeof claims.sub !== "string" || claims.sub.length < 1 || claims.sub.length > 300) throw new OidcError("OIDC_SUBJECT_INVALID");
  return claims;
}

export const emailVerified = (c: IdClaims) => c.email_verified === true || c.email_verified === "true";
