import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanUri, summariseReport } from "./csp-report";
import { POST } from "../../app/api/ops/csp-report/route";

const legacy = (over: Record<string, string> = {}) => ({ "csp-report": { "document-uri": "https://www.quizbox.io/practise?token=secret#frag", "violated-directive": "img-src https://x.example", "effective-directive": "img-src", "blocked-uri": "https://cdn.example.com/a/b.png?sig=abc#x", disposition: "report", ...over } });
afterEach(() => vi.restoreAllMocks());

describe("CSP reports", () => {
  it("keeps only the directive, the blocked address without query or fragment, and the page path", () => {
    expect(summariseReport(legacy())).toEqual({ directive: "img-src", blocked: "https://cdn.example.com/a/b.png", page: "/practise", mode: "report" });
  });
  it("reads the newer Reporting API format too", () => {
    const body = [{ type: "csp-violation", body: { effectiveDirective: "script-src-elem", blockedURL: "inline", documentURL: "https://www.quizbox.io/", disposition: "enforce" } }];
    expect(summariseReport(body)).toEqual({ directive: "script-src-elem", blocked: "inline", page: "/", mode: "enforce" });
  });
  it("ignores browser extensions, junk and reports with nothing in them", () => {
    expect(summariseReport(legacy({ "blocked-uri": "chrome-extension://abcdef/content.js" }))).toBeNull();
    expect(summariseReport(legacy({ "blocked-uri": "moz-extension://abc/x.js" }))).toBeNull();
    expect(summariseReport({})).toBeNull(); expect(summariseReport(null)).toBeNull(); expect(summariseReport("text")).toBeNull(); expect(summariseReport([])).toBeNull();
  });
  it("cleans odd characters out of an address", () => {
    expect(cleanUri("data:text/html,<script>alert(1)</script>")).not.toMatch(/[<>()]/);
    expect(cleanUri("not a url at all")).toBe("notaurlatall");
    expect(cleanUri("https://[bad")).toBe("invalid");
  });
  it("always answers 204, logs one clean line, and never echoes or stores the report", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const post = (body: string) => POST(new Request("https://www.quizbox.io/api/ops/csp-report", { method: "POST", body }));
    expect((await post(JSON.stringify(legacy()))).status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe("[csp] report directive=img-src blocked=https://cdn.example.com/a/b.png page=/practise");
    expect(String(warn.mock.calls[0][0])).not.toContain("secret");
    for (const junk of ["", "not json", "x".repeat(9000), "{}"]) expect((await post(junk)).status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
