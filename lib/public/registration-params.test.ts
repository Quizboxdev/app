import { describe, expect, it } from "vitest";
import { parseRegistrationParams, registerHref } from "./registration-params";

describe("parseRegistrationParams", () => {
  it("defaults to login when no mode is given", () => {
    expect(parseRegistrationParams({})).toEqual({ mode: "login", role: null, country: null, intent: null });
    expect(parseRegistrationParams(undefined).mode).toBe("login");
  });

  it("ignores role and country outside register mode", () => {
    expect(parseRegistrationParams({ role: "teacher", country: "GH" })).toEqual({ mode: "login", role: null, country: null, intent: null });
  });

  it("accepts recognised roles case-insensitively", () => {
    expect(parseRegistrationParams({ mode: "register", role: "Student" }).role).toBe("student");
    expect(parseRegistrationParams({ mode: "REGISTER", role: "teacher" }).role).toBe("teacher");
    expect(parseRegistrationParams({ mode: "register", role: "sponsor" }).role).toBe("sponsor");
  });

  it("rejects privileged or unknown roles", () => {
    for (const role of ["admin", "owner", "sme", "school", "student<script>", ""]) {
      expect(parseRegistrationParams({ mode: "register", role }).role).toBeNull();
    }
  });

  it("only keeps two-letter country codes", () => {
    expect(parseRegistrationParams({ mode: "register", country: "gh" }).country).toBe("GH");
    for (const country of ["GHA", "G1", "", "../x", "GH;drop"]) {
      expect(parseRegistrationParams({ mode: "register", country }).country).toBeNull();
    }
  });

  it("keeps the SME intent only for teacher registration", () => {
    expect(parseRegistrationParams({ mode: "register", role: "teacher", intent: "sme" }).intent).toBe("sme");
    expect(parseRegistrationParams({ mode: "register", role: "student", intent: "sme" }).intent).toBeNull();
    expect(parseRegistrationParams({ mode: "register", role: "teacher", intent: "admin" }).intent).toBeNull();
  });

  it("uses the first value of repeated parameters and rejects oversized input", () => {
    expect(parseRegistrationParams({ mode: ["register", "login"], role: ["teacher", "admin"] })).toMatchObject({ mode: "register", role: "teacher" });
    expect(parseRegistrationParams({ mode: "register", role: "t".repeat(64) }).role).toBeNull();
  });

  it("reads URLSearchParams", () => {
    expect(parseRegistrationParams(new URLSearchParams("mode=register&role=student&country=GH"))).toEqual({ mode: "register", role: "student", country: "GH", intent: null });
  });
});

describe("registerHref", () => {
  it("builds register deep links", () => {
    expect(registerHref()).toBe("/login?mode=register");
    expect(registerHref({ role: "teacher", intent: "sme" })).toBe("/login?mode=register&role=teacher&intent=sme");
    expect(registerHref({ role: "student", country: "GH" })).toBe("/login?mode=register&role=student&country=GH");
  });
});
