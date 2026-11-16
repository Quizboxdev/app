import { describe, expect, it } from "vitest";
import { captchaEnabled, captchaOptions } from "./captcha";

describe("captcha helpers", () => {
  it("is off without a site key", () => {
    expect(captchaEnabled(undefined)).toBe(false);
    expect(captchaEnabled("")).toBe(false);
    expect(captchaEnabled("   ")).toBe(false);
  });
  it("is on with a site key", () => {
    expect(captchaEnabled("0x4AAAAAAAexample")).toBe(true);
  });
  it("sends nothing extra when there is no token", () => {
    expect(captchaOptions(null)).toEqual({});
    expect(captchaOptions(undefined)).toEqual({});
    expect(captchaOptions("")).toEqual({});
  });
  it("sends the token the way Supabase Auth expects", () => {
    expect(captchaOptions("tok")).toEqual({ captchaToken: "tok" });
  });
});
