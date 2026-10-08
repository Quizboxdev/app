import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parsePackage } from "./package";

const row = (subject: string, url: string, extra: Record<string, string> = {}) => ({ level: "JHS (Basic 7-9)", subject, title: `${subject} curriculum`, url, source_type: "official PDF", status: "verified", ...extra });
async function zip(files: Record<string, string | Uint8Array>) { const z = new JSZip(); for (const [k, v] of Object.entries(files)) z.file(k, v); return z.generateAsync({ type: "uint8array" }); }

describe("curriculum source-pack parsing", () => {
  it("reads a country pack, prefers JSON over the duplicate CSV and hashes bundled files", async () => {
    const bytes = await zip({
      "curriculum_sources.json": JSON.stringify({ country: "Ghana", research_date: "2026-10-03", notes: ["NaCCA is the authority."], sources: [row("Computing", "https://nacca.gov.gh/c.pdf"), row("Mathematics", "https://nacca.gov.gh/m.pdf")] }),
      "curriculum_sources.csv": "level,subject,title,url,source_type,status\nJHS,Computing,Computing,https://nacca.gov.gh/c.pdf,official PDF,verified\n",
      "README.md": "# pack", "download.py": "print()", "User_Copy.pdf": new Uint8Array([37, 80, 68, 70, 45]) });
    const pkg = await parsePackage("Ghana_Pack.zip", bytes);
    expect(pkg).toMatchObject({ package_type: "COUNTRY_PACK", research_date: "2026-10-03", notes: ["NaCCA is the authority."], groups: [{ country: "Ghana", rows: [{ subject: "Computing" }, { subject: "Mathematics" }] }] });
    expect(pkg.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pkg.attachments).toEqual([{ name: "User_Copy.pdf", bytes: 5, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
  });

  it("splits a consolidated multi-country pack by the country each manifest declares", async () => {
    const bytes = await zip({
      "ghana/curriculum_sources.json": JSON.stringify({ country: "Ghana", sources: [row("Computing", "https://nacca.gov.gh/c.pdf")] }),
      "nigeria/curriculum_sources.json": JSON.stringify({ country: "Nigeria", sources: [row("Computer Studies", "https://nerdc.gov.ng/cs.pdf"), row("Mathematics", "https://nerdc.gov.ng/m.pdf")] }),
      "kenya/curriculum_sources.json": JSON.stringify({ country: "Kenya", sources: [row("Computer Science", "https://kicd.ac.ke/cs.pdf")] }),
      "kenya/curriculum_sources.csv": "level,subject,title,url\nJSS,Computer Science,x,https://kicd.ac.ke/cs.pdf\n" });
    const pkg = await parsePackage("Six_Country_Pack.zip", bytes);
    expect(pkg.package_type).toBe("MULTI_COUNTRY_PACK");
    expect(pkg.groups.map((g) => [g.country, g.rows.length])).toEqual([["Ghana", 1], ["Nigeria", 2], ["Kenya", 1]]);
  });

  it("supports row-level countries, CSV country columns and declared global packs", async () => {
    const rows = await parsePackage("multi.json", new TextEncoder().encode(JSON.stringify({ sources: [{ ...row("Computing", "https://nacca.gov.gh/c.pdf"), country: "GH" }, { ...row("Computing", "https://kicd.ac.ke/c.pdf"), country: "KE" }] })));
    expect(rows.groups.map((g) => g.country)).toEqual(["GH", "KE"]);
    const csv = await parsePackage("pack.csv", new TextEncoder().encode("country,level,subject,title,url,source_type,status\nNigeria,JSS,Mathematics,Maths,https://nerdc.gov.ng/m.pdf,official PDF,verified\n"));
    expect(csv).toMatchObject({ package_type: "COUNTRY_PACK", groups: [{ country: "Nigeria", rows: [{ subject: "Mathematics" }] }] });
    const global = await parsePackage("global.json", new TextEncoder().encode(JSON.stringify({ package_type: "GLOBAL_SOURCE_PACK", country: "International", sources: [row("Computing", "https://example.org/c.pdf")] })));
    expect(global.package_type).toBe("GLOBAL_SOURCE_PACK");
  });

  it("never infers a country from a folder or file name", async () => {
    await expect(parsePackage("ghana.csv", new TextEncoder().encode("level,subject,title,url\nJHS,Computing,c,https://nacca.gov.gh/c.pdf\n"))).rejects.toThrow("MANIFEST_COUNTRY_MISSING");
    await expect(parsePackage("x.zip", await zip({ "ghana/notes.txt": "hello" }))).rejects.toThrow("PACKAGE_MANIFEST_NOT_FOUND");
    await expect(parsePackage("x.docx", new Uint8Array([1]))).rejects.toThrow("PACKAGE_FORMAT_UNSUPPORTED");
  });
});

describe("package error text shown to admins", () => {
  it("maps every parser error code to readable text and keeps the file detail", async () => {
    const { describeErrorMessage } = await import("@/lib/errors");
    for (const code of ["PACKAGE_MANIFEST_NOT_FOUND", "PACKAGE_FORMAT_UNSUPPORTED", "PACKAGE_TOO_LARGE", "PACKAGE_EMPTY", "PACKAGE_JSON_INVALID", "MANIFEST_COUNTRY_MISSING"]) expect(describeErrorMessage(code)).not.toBe(code);
    expect(describeErrorMessage("PACKAGE_JSON_INVALID: ghana/sources.json")).toBe("A JSON file in the package is not valid JSON. (ghana/sources.json)");
    expect(describeErrorMessage("Something the server said")).toBe("Something the server said");
  });
});
