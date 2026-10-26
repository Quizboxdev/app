import { createHash, createHmac, createSign, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OidcError, buildAuthorizationUrl, clearJwksCache, exchangeCode, fetchJwks, pkcePair, verifyIdToken } from "./oidc";

const ISS = "https://login.school.example", AUD = "quizbox-client", NONCE = "nonce-123", NOW = 1_900_000_000;
const cfg = { issuer: ISS, audience: AUD, jwks_uri: "https://login.school.example/jwks" };
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }), ec = generateKeyPairSync("ec", { namedCurve: "P-256" }), rsa2 = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = (pub: any, kid: string, extra: object = {}) => ({ ...pub.export({ format: "jwk" }), kid, use: "sig", ...extra });
const keys = [jwk(rsa.publicKey, "rsa-1", { alg: "RS256" }), jwk(ec.publicKey, "ec-1", { alg: "ES256" })];
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const claims = (over: object = {}) => ({ iss: ISS, aud: AUD, sub: "user-1", exp: NOW + 600, iat: NOW - 10, nonce: NONCE, email: "a@school.example", email_verified: true, ...over });
function token(c: object, alg: "RS256" | "ES256" = "RS256", kid = alg === "RS256" ? "rsa-1" : "ec-1", privateKey: any = alg === "RS256" ? rsa.privateKey : ec.privateKey) {
  const head = b64({ alg, typ: "JWT", kid }), body = b64(c), data = `${head}.${body}`;
  const sig = alg === "RS256" ? createSign("RSA-SHA256").update(data).sign(privateKey) : cryptoSign("sha256", Buffer.from(data), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${data}.${sig.toString("base64url")}`;
}
const verify = (t: string, over: object = {}) => verifyIdToken(t, cfg, { nonce: NONCE, nowSeconds: NOW, fetchJwks: async () => keys as any, ...over });
const codeOf = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return e instanceof OidcError ? e.code : `OTHER:${(e as Error).message}`; } };

describe("ID token verification", () => {
  it("accepts a valid RS256 and a valid ES256 token", async () => {
    expect((await verify(token(claims()))).sub).toBe("user-1");
    expect((await verify(token(claims(), "ES256"))).sub).toBe("user-1");
  });
  it("accepts an audience list that names us when the authorized party is us", async () => {
    expect(await codeOf(verify(token(claims({ aud: [AUD, "other"], azp: AUD }))))).toBe("OK");
    expect(await codeOf(verify(token(claims({ aud: [AUD, "other"] }))))).toBe("OIDC_AZP_MISMATCH");
  });
  it("rejects a tampered payload and a token signed by a different key", async () => {
    const t = token(claims()), [h, , s] = t.split(".");
    expect(await codeOf(verify(`${h}.${b64(claims({ sub: "admin" }))}.${s}`))).toBe("OIDC_SIGNATURE_INVALID");
    expect(await codeOf(verify(token(claims(), "RS256", "rsa-1", rsa2.privateKey)))).toBe("OIDC_SIGNATURE_INVALID");
  });
  it("rejects alg none, HMAC (key confusion) and unknown algorithms", async () => {
    const none = `${b64({ alg: "none" })}.${b64(claims())}.`;
    expect(await codeOf(verify(none))).toBe("OIDC_TOKEN_INVALID");
    const hs = `${b64({ alg: "HS256", kid: "rsa-1" })}.${b64(claims())}`;
    const hsTok = `${hs}.${createHmac("sha256", JSON.stringify(keys[0])).update(hs).digest("base64url")}`;
    expect(await codeOf(verify(hsTok))).toBe("OIDC_ALG_NOT_ALLOWED");
    expect(await codeOf(verify(`${b64({ alg: "PS256", kid: "rsa-1" })}.${b64(claims())}.AAAA`))).toBe("OIDC_ALG_NOT_ALLOWED");
  });
  it("rejects a key of the wrong type for the algorithm and an unknown key id", async () => {
    expect(await codeOf(verify(token(claims(), "RS256", "ec-1")))).toBe("OIDC_KEY_NOT_FOUND");
    expect(await codeOf(verify(token(claims(), "RS256", "missing")))).toBe("OIDC_KEY_NOT_FOUND");
  });
  it("rejects the wrong issuer, audience, expiry, not-before, future issue time, nonce and subject", async () => {
    expect(await codeOf(verify(token(claims({ iss: "https://evil.example" }))))).toBe("OIDC_ISSUER_MISMATCH");
    expect(await codeOf(verify(token(claims({ aud: "someone-else" }))))).toBe("OIDC_AUDIENCE_MISMATCH");
    expect(await codeOf(verify(token(claims({ exp: NOW - 61 }))))).toBe("OIDC_TOKEN_EXPIRED");
    expect(await codeOf(verify(token(claims({ exp: NOW - 30 }))))).toBe("OK");           // inside the 60 second clock skew
    expect(await codeOf(verify(token(claims({ nbf: NOW + 500 }))))).toBe("OIDC_TOKEN_NOT_YET_VALID");
    expect(await codeOf(verify(token(claims({ iat: NOW + 1000 }))))).toBe("OIDC_TOKEN_NOT_YET_VALID");
    expect(await codeOf(verify(token(claims({ nonce: "other" }))))).toBe("OIDC_NONCE_MISMATCH");
    expect(await codeOf(verify(token(claims({ nonce: undefined }))))).toBe("OIDC_NONCE_MISMATCH");
    expect(await codeOf(verify(token(claims({ sub: "" }))))).toBe("OIDC_SUBJECT_INVALID");
    expect(await codeOf(verify(token(claims({ exp: "soon" }))))).toBe("OIDC_TOKEN_EXPIRED");
  });
  it("rejects malformed and oversize tokens", async () => {
    for (const t of ["", "a.b", "a.b.c.d", "not a token", "x".repeat(9000)]) expect(await codeOf(verify(t))).toBe("OIDC_TOKEN_INVALID");
  });
});

describe("authorization request, PKCE and code exchange", () => {
  beforeEach(() => clearJwksCache());
  it("builds a code + PKCE + state + nonce request and refuses a non-https endpoint", () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url")); expect(verifier.length).toBeGreaterThanOrEqual(43);
    const u = new URL(buildAuthorizationUrl({ authorization_endpoint: "https://idp.example/auth", audience: AUD }, { redirectUri: "https://www.quizbox.io/api/partner/v1/sso/callback", state: "st", nonce: "no", challenge }));
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: "code", client_id: AUD, state: "st", nonce: "no", code_challenge: challenge, code_challenge_method: "S256", scope: "openid email profile" });
    expect(() => buildAuthorizationUrl({ authorization_endpoint: "http://idp.example/auth", audience: AUD }, { redirectUri: "x", state: "s", nonce: "n", challenge })).toThrow(OidcError);
  });
  it("exchanges the code with the verifier and the client secret, and surfaces failures as codes", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id_token: "tok" }), { status: 200 }));
    expect(await exchangeCode({ token_endpoint: "https://idp.example/token", audience: AUD }, { code: "c", verifier: "v", redirectUri: "https://r", clientSecret: "sec" }, f as any)).toBe("tok");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://idp.example/token"); expect(String(init.body)).toContain("code_verifier=v"); expect((init.headers as any).authorization).toMatch(/^Basic /);
    expect(await codeOf(exchangeCode({ token_endpoint: "https://idp.example/token", audience: AUD }, { code: "c", verifier: "v", redirectUri: "r" }, (async () => new Response("no", { status: 400 })) as any))).toBe("OIDC_TOKEN_EXCHANGE_FAILED");
    expect(await codeOf(exchangeCode({ token_endpoint: "https://idp.example/token", audience: AUD }, { code: "c", verifier: "v", redirectUri: "r" }, (async () => new Response("{}", { status: 200 })) as any))).toBe("OIDC_NO_ID_TOKEN");
    expect(await codeOf(exchangeCode({ token_endpoint: "http://idp.example/token", audience: AUD }, { code: "c", verifier: "v", redirectUri: "r" }, f as any))).toBe("OIDC_ENDPOINT_NOT_HTTPS");
  });
  it("caches the key set for a few minutes, refuses http and oversize responses", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ keys }), { status: 200 }));
    await fetchJwks("https://idp.example/jwks", f as any, 1000); await fetchJwks("https://idp.example/jwks", f as any, 2000);
    expect(f).toHaveBeenCalledTimes(1);
    await fetchJwks("https://idp.example/jwks", f as any, 1000 + 6 * 60_000);
    expect(f).toHaveBeenCalledTimes(2);
    expect(await codeOf(fetchJwks("http://idp.example/jwks", f as any))).toBe("OIDC_ENDPOINT_NOT_HTTPS");
    clearJwksCache();
    expect(await codeOf(fetchJwks("https://big.example/jwks", (async () => new Response("x".repeat(200_000))) as any))).toBe("OIDC_RESPONSE_TOO_LARGE");
  });
});
