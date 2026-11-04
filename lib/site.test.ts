import { describe, expect, it } from "vitest";
import { returnOrigin, SITE_URL } from "./site";

describe("returnOrigin", () => {
  it("sends the buyer back to the site they paid from", () => {
    expect(returnOrigin("https://preview.quizbox.io/api/payments/checkout")).toBe("https://preview.quizbox.io");
    expect(returnOrigin("https://www.quizbox.io/api/payments/checkout")).toBe("https://www.quizbox.io");
    expect(returnOrigin("https://quizbox.io/api/marketplace/checkout")).toBe("https://quizbox.io");
  });
  it("never returns a buyer to a host that is not quizbox.io", () => {
    const canonical = new URL(SITE_URL).origin;
    for (const bad of ["https://evil.example/x", "https://quizbox.io.evil.example/x", "https://notquizbox.io/x", "http://preview.quizbox.io/x", "http://localhost:3000/x", "not a url", ""]) expect(returnOrigin(bad), bad).toBe(canonical);
  });
});
