import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Regression guard (guide audit 2026-11-20): since the social sign-in change, two statements that pre-fill "Country" and "I am a" from the sign-up details
// ended up inside a `//` comment, so a teacher or sponsor who followed a role link and pressed Continue was registered as a student.
const source = readFileSync(new URL("../../app/onboarding/page.tsx", import.meta.url), "utf8");
const lines = source.split(/\r?\n/);

describe("onboarding pre-fills country and role from the sign-up details", () => {
  it("applies the country as real code, not inside a comment", () => {
    expect(lines.some((l) => /^\s*setCountryCode\(String\(meta\.country_code/.test(l))).toBe(true);
  });
  it("applies the role as real code, not inside a comment", () => {
    // A sponsor who chose "Parent or guardian" at sign-up (sponsor_type INDIVIDUAL) comes back as the parent choice.
    expect(lines.some((l) => /^\s*if \(\["student", "teacher", "sponsor"\]\.includes\(meta\.role\)\) setRole\(meta\.role === "sponsor" && meta\.sponsor_type === "INDIVIDUAL" \? "parent" : meta\.role\);/.test(l))).toBe(true);
  });
  it("no line hides executable statements after a comment marker", () => {
    const hidden = lines.map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => /\/\/[^\n]*\b(set[A-Z]\w+\(|router\.\w+\()/.test(l) && !/^\s*\/\//.test(l) && !/https?:\/\//.test(l));
    expect(hidden.map((h) => h.n)).toEqual([]);
  });
});
