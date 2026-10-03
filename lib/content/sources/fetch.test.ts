import { describe, expect, it } from "vitest";
import { fetchClaimedSources, fetchOfficialPdf, officialHost } from "./fetch";

const pdf = Buffer.from("%PDF-1.4 fake");
const reply = (status: number, body: Buffer | string = "", headers: Record<string, string> = {}) => new Response(typeof body === "string" ? body : new Uint8Array(body), { status, headers });

describe("official curriculum fetch guard", () => {
  it("accepts only https URLs on an official domain or its subdomains", () => {
    expect(officialHost("https://nacca.gov.gh/x.pdf", ["nacca.gov.gh"])).toBe(true);
    expect(officialHost("https://www.nacca.gov.gh/x.pdf", ["nacca.gov.gh"])).toBe(true);
    expect(officialHost("http://nacca.gov.gh/x.pdf", ["nacca.gov.gh"])).toBe(false);
    expect(officialHost("https://nacca.gov.gh.evil.com/x.pdf", ["nacca.gov.gh"])).toBe(false);
    expect(officialHost("https://user:pw@nacca.gov.gh/x.pdf", ["nacca.gov.gh"])).toBe(false);
    expect(officialHost("https://nacca.gov.gh:8443/x.pdf", ["nacca.gov.gh"])).toBe(false);
  });

  it("re-checks every redirect hop and requires a real PDF", async () => {
    const redirectOut = async () => reply(302, "", { location: "https://evil.example.com/x.pdf" });
    await expect(fetchOfficialPdf("https://nacca.gov.gh/x.pdf", ["nacca.gov.gh"], redirectOut as typeof fetch)).rejects.toThrow("HOST_NOT_OFFICIAL");
    let hops = 0;
    const redirectIn = async () => (hops++ === 0 ? reply(301, "", { location: "/wp-content/x.pdf" }) : reply(200, pdf));
    expect((await fetchOfficialPdf("https://nacca.gov.gh/x.pdf", ["nacca.gov.gh"], redirectIn as typeof fetch)).subarray(0, 5).toString()).toBe("%PDF-");
    await expect(fetchOfficialPdf("https://nacca.gov.gh/x.pdf", ["nacca.gov.gh"], (async () => reply(200, "<html>index</html>")) as typeof fetch)).rejects.toThrow("NOT_A_PDF");
    await expect(fetchOfficialPdf("https://nacca.gov.gh/x.pdf", ["nacca.gov.gh"], (async () => reply(404)) as typeof fetch)).rejects.toThrow("PDF_NOT_FOUND");
    await expect(fetchOfficialPdf("https://nacca.gov.gh/x.pdf", ["nacca.gov.gh"], (async () => reply(200, pdf, { "content-length": String(60 * 1024 * 1024) })) as typeof fetch)).rejects.toThrow("SOURCE_TOO_LARGE");
  });

  it("reports failures back to the registry without storing or approving anything", async () => {
    const calls: Array<{ action: string; data: any }> = []; const stored: string[] = [];
    const rpc = (async (_name: string, args: any) => { calls.push({ action: args.p_action, data: args.p_data }); return args.p_action === "claim_fetch" ? [{ id: "r1", token: "t1", url: "https://evil.example.com/x.pdf", title: "x", market_id: "m1", official_domains: ["nacca.gov.gh"] }] : {}; }) as any;
    const result = await fetchClaimedSources(rpc, async (p) => { stored.push(p); }, { limit: 1 });
    expect(result.outcomes).toEqual([{ id: "r1", title: "x", status: "FETCH_FAILED", error: "HOST_NOT_OFFICIAL" }]);
    expect(calls.map((c) => c.action)).toEqual(["claim_fetch", "fail_fetch"]); expect(stored).toEqual([]);
  });
});
