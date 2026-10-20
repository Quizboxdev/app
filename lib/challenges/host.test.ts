import { describe, expect, it } from "vitest";
import { challengeHostRedirect } from "./host";

describe("challengeHostRedirect", () => {
  it("sends the challenge host to the main site", () => {
    expect(challengeHostRedirect("challenge.quizbox.io", "/")).toBe("https://www.quizbox.io/challenges");
    expect(challengeHostRedirect("challenge.quizbox.io", "/maths-sprint")).toBe("https://www.quizbox.io/challenges/maths-sprint");
    expect(challengeHostRedirect("challenge.quizbox.io", "/maths-sprint/")).toBe("https://www.quizbox.io/challenges/maths-sprint");
    expect(challengeHostRedirect("Challenges.QuizBox.io:443", "/challenges/book-week")).toBe("https://www.quizbox.io/challenges/book-week");
    expect(challengeHostRedirect("challenge.quizbox.io", "/play/book-week")).toBe("https://www.quizbox.io/play/book-week");
    expect(challengeHostRedirect("challenge.quizbox.io", "/competitions/spelling-cup")).toBe("https://www.quizbox.io/competitions/spelling-cup");
  });
  it("never forwards unknown paths, so it cannot open anything else", () => {
    for (const p of ["/admin", "/admin/inbox", "/a/b/c", "/..%2fadmin", "//evil.example", "/x?y=1"]) expect(challengeHostRedirect("challenge.quizbox.io", p)).toMatch(/^https:\/\/www\.quizbox\.io\/challenges(\/[a-z0-9-]+)?$/);
  });
  it("leaves every other host and the framework paths alone", () => {
    for (const h of ["www.quizbox.io", "quizbox.io", "quizbox-nine.vercel.app", "localhost:3000", "", null, undefined, "evilchallenge.quizbox.io"]) expect(challengeHostRedirect(h, "/")).toBeNull();
    expect(challengeHostRedirect("challenge.quizbox.io", "/_next/static/x.js")).toBeNull();
    expect(challengeHostRedirect("challenge.quizbox.io", "/api/challenges/view")).toBeNull();
  });
});
