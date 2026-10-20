import { describe, expect, it } from "vitest";
import { loginHrefFor, safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it("accepts only challenge paths", () => {
    expect(safeNextPath("/play/maths-sprint")).toBe("/play/maths-sprint");
    expect(safeNextPath("/challenges/book-week-2")).toBe("/challenges/book-week-2");
    expect(safeNextPath("/competitions/spelling-cup")).toBe("/competitions/spelling-cup");
  });
  it("rejects anything that could leave the app or reach a private area", () => {
    for (const bad of ["https://evil.example/play/x", "//evil.example", "/\\evil", "/play/../admin", "/admin", "/play/", "/play/x?y=1", "/play/X", "javascript:alert(1)", "", null, undefined, 5, "/play/" + "a".repeat(100)]) expect(safeNextPath(bad)).toBeNull();
  });
  it("builds a login link only for safe paths", () => {
    expect(loginHrefFor("/play/maths-sprint")).toBe("/login?next=%2Fplay%2Fmaths-sprint");
    expect(loginHrefFor("/admin")).toBe("/login");
  });
});
