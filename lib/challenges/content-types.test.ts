import { describe, expect, it } from "vitest";
import { CONTENT_TYPES, contentType, levelFromGrade } from "./content-types";

describe("content types and levels", () => {
  it("has the types the database accepts, each with a kind the upload route understands", () => {
    expect(CONTENT_TYPES.map((t) => t.id)).toEqual(["story_book", "faith_book", "doctrine", "corporate", "marketing", "textbook", "article", "other"]);
    expect(new Set(CONTENT_TYPES.map((t) => t.kind))).toEqual(new Set(["book", "article", "notes"]));
    expect(contentType("nonsense").id).toBe("other"); expect(contentType("faith_book").plural).toBe("faith books");
  });
  it("maps a learner's grade to the level sponsored quizzes are aimed at", () => {
    expect(levelFromGrade("B4")).toBe("PRIMARY"); expect(levelFromGrade("b6")).toBe("PRIMARY"); expect(levelFromGrade("B7")).toBe("JHS"); expect(levelFromGrade("B 9")).toBe("JHS");
    expect(levelFromGrade("SHS 2")).toBe("SHS"); expect(levelFromGrade("SHS1")).toBe("SHS"); expect(levelFromGrade("")).toBeUndefined(); expect(levelFromGrade(null)).toBeUndefined(); expect(levelFromGrade("B12")).toBeUndefined();
  });
});
