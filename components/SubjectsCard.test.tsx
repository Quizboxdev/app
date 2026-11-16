import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/markets", () => ({ getMyAccount: () => Promise.resolve({ student: null }), listSignupCountries: () => Promise.resolve([]), setMySubjects: () => Promise.resolve([]) }));

import SubjectsCard from "./SubjectsCard";

describe("SubjectsCard", () => {
  it("shows nothing until the learner's subject list has loaded", () => {
    expect(renderToStaticMarkup(<SubjectsCard />)).toBe("");
  });
});
