import { describe, expect, it } from "vitest";
import { sourceMatchesSubject, sourcesForSubjects } from "./sources";

// The eleven approved Primary sources as they are titled in Admin, and the subject name each prepared question file uses.
const SOURCES = [
  "Computing B4-B6 Standards-Based Curriculum", "Creative Arts B4-B6 Standards-Based Curriculum", "English Upper Primary B4-B6 Standards-Based Curriculum",
  "French B4-B6 Standards-Based Curriculum", "Ghanaian Language B4-B6 Standards-Based Curriculum", "History of Ghana B1-B6 Standards-Based Curriculum",
  "Mathematics Upper Primary B4-B6 Standards-Based Curriculum", "Our World and Our People B4-B6 Standards-Based Curriculum", "Physical Education B1-B6 Standards-Based Curriculum",
  "Religious and Moral Education B1-B6 Standards-Based Curriculum", "Science Upper Primary B4-B6 Standards-Based Curriculum",
].map((title, i) => ({ id: `s${i}`, title }));
const FILE_SUBJECTS: Array<[string, string]> = [
  ["Computing", "Computing"], ["Creative Arts", "Creative Arts"], ["English Language", "English Upper Primary"], ["FRENCH", "French"], ["Ghanaian Language", "Ghanaian Language"],
  ["History", "History of Ghana"], ["Mathematics", "Mathematics Upper Primary"], ["Our World Our People", "Our World and Our People"], ["Physical Education", "Physical Education"],
  ["Religious and Moral Education", "Religious and Moral Education"], ["Science", "Science Upper Primary"],
];

describe("choosing the source for a question file", () => {
  it("matches each subject to exactly its own source, never a neighbour that shares a word", () => {
    for (const [subject, startOfTitle] of FILE_SUBJECTS) {
      const hits = sourcesForSubjects(SOURCES, [subject]);
      expect(hits, subject).toHaveLength(1);
      expect(SOURCES.find((s) => s.id === hits[0])!.title.startsWith(startOfTitle), subject).toBe(true);
    }
  });
  it("understands the short names teachers use", () => {
    expect(sourcesForSubjects(SOURCES, ["RME"])).toEqual(["s9"]);
    expect(sourcesForSubjects(SOURCES, ["PE"])).toEqual(["s8"]);
    expect(sourcesForSubjects(SOURCES, ["Creative Arts and Design"])).toEqual(["s1"]);
  });
  it("picks nothing when no source matches, so the admin has to choose", () => {
    expect(sourcesForSubjects(SOURCES, ["Astronomy"])).toEqual([]);
    expect(sourcesForSubjects(SOURCES, [""])).toEqual([]);
    expect(sourcesForSubjects(SOURCES, [])).toEqual([]);
  });
  it("picks one source per subject for a file that mixes subjects", () => {
    expect(sourcesForSubjects(SOURCES, ["Science", "History"]).sort()).toEqual(["s10", "s5"]);
  });
  it("does not let grade or level words decide a match", () => {
    expect(sourceMatchesSubject("Science B7-B9 Common Core Programme", "Science")).toBe(true);
    expect(sourceMatchesSubject("Social Studies B7-B9 Common Core Programme", "Science")).toBe(false);
  });
});
