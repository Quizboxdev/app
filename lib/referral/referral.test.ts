import { describe, expect, it, vi } from "vitest";
import { clearReferralCookieHeader, normaliseCode, readReferralCookie, referralCookieHeader } from "./code";

describe("referral codes and the cookie that carries them", () => {
  it("accepts only 6 to 12 letters and digits, in capitals", () => {
    expect(normaliseCode("  ab12cd34 ")).toBe("AB12CD34");
    for (const bad of ["", "abc", "a b c d e f g h i j k l m", "AB12-CD34", "<script>alert(1)</script>", "AB12CD34; Path=/; Domain=evil.com", null, undefined]) expect(normaliseCode(bad)).toBeNull();
  });
  it("sets a 30-day, same-site cookie, with Secure on https only", () => {
    expect(referralCookieHeader("AB12CD34", true)).toBe("qb_ref=AB12CD34; Path=/; Max-Age=2592000; SameSite=Lax; Secure");
    expect(referralCookieHeader("AB12CD34", false)).not.toContain("Secure");
    expect(clearReferralCookieHeader()).toContain("Max-Age=0");
  });
  it("reads the code back out of a cookie string, ignoring other cookies and tampered values", () => {
    expect(readReferralCookie("a=1; qb_ref=AB12CD34; b=2")).toBe("AB12CD34");
    expect(readReferralCookie("a=1; b=2")).toBeNull();
    expect(readReferralCookie("qb_ref=%3Cscript%3E")).toBeNull();
  });
});

describe("the /r/CODE link", () => {
  const call = async (code: string, url = "https://www.quizbox.io/r/x") => {
    const { GET } = await import("@/app/r/[code]/route");
    return GET(new Request(url), { params: Promise.resolve({ code }) });
  };
  it("remembers a valid code and goes to the home page without caching", async () => {
    const res = await call("ab12cd34");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://www.quizbox.io/");
    expect(res.headers.get("set-cookie")).toContain("qb_ref=AB12CD34");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("sets nothing for something that cannot be a code, but still goes home", async () => {
    for (const bad of ["x", "<b>", "AB12CD34%3Bevil"]) {
      const res = await call(bad);
      expect(res.status).toBe(307);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });
});

describe("capturing after sign-in", () => {
  it("asks the database once, then clears the cookie; and does nothing without a cookie", async () => {
    vi.resetModules();
    const referralCapture = vi.fn(async () => ({ outcome: "attributed" }));
    vi.doMock("@/lib/api/affiliates", () => ({ referralCapture }));
    const { captureReferralIfAny } = await import("./capture");
    const doc = { cookie: "qb_ref=AB12CD34" };
    expect(await captureReferralIfAny(doc)).toBe("attributed");
    expect(referralCapture).toHaveBeenCalledWith("AB12CD34");
    expect(doc.cookie).toContain("Max-Age=0");
    expect(await captureReferralIfAny({ cookie: "x=1" })).toBeNull();
    expect(referralCapture).toHaveBeenCalledTimes(1);
  });
  it("keeps the cookie if the call fails, so it can be tried again", async () => {
    vi.resetModules();
    vi.doMock("@/lib/api/affiliates", () => ({ referralCapture: vi.fn(async () => { throw new Error("offline"); }) }));
    const { captureReferralIfAny } = await import("./capture");
    const doc = { cookie: "qb_ref=AB12CD34" };
    expect(await captureReferralIfAny(doc)).toBeNull();
    expect(doc.cookie).toBe("qb_ref=AB12CD34");
  });
});
