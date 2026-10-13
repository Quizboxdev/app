import { describe, expect, it } from "vitest";
import { showPublic } from "./visibility";

describe("public home visibility", () => {
  it("hides only what is explicitly false and shows unknown keys", () => {
    const cfg = { home_sections: { governance: false, students: true } };
    expect(showPublic("governance", cfg)).toBe(false);
    expect(showPublic("students", cfg)).toBe(true);
    expect(showPublic("never_listed", cfg)).toBe(true);
    expect(showPublic("governance", {})).toBe(true);
  });
  it("the committed file hides the internal-mechanics sections by default", () => {
    expect(showPublic("governance")).toBe(false);
    expect(showPublic("reviewers")).toBe(false);
    expect(showPublic("content_pipeline")).toBe(false);
    expect(showPublic("students")).toBe(true);
  });
});
