import { describe, expect, it } from "vitest";
import { verificationView } from "./verification";

describe("what a sponsor is told about verification", () => {
  it("treats a missing status as waiting and explains why children's safety needs the check", () => {
    expect(verificationView(undefined)).toMatchObject({ tone: "info", label: "Waiting for verification" });
    expect(verificationView("pending").message).toMatch(/behind a sponsor/);
  });
  it("says verified plainly", () => { expect(verificationView("VERIFIED")).toMatchObject({ tone: "ok", label: "Verified" }); });
  it("includes the reason for a decline, and works without one", () => {
    expect(verificationView("REJECTED", " No registration found. ").message).toContain("Reason: No registration found.");
    expect(verificationView("REJECTED").message).not.toContain("Reason");
  });
});
