import { describe, expect, it } from "vitest";
import { countBySource, filterBySource, sourceOf } from "./work-source";

describe("work source", () => {
  it("is family only when the work says so; everything else, including older work with no source, is school", () => {
    expect(sourceOf({ source_type: "family" })).toBe("family");
    expect(sourceOf({ assignments: { source_type: "family" } })).toBe("family");
    for (const row of [{}, { source_type: "school" }, { source_type: null }, { assignments: null }, { source_type: "weird" }, undefined, null]) expect(sourceOf(row as any)).toBe("school");
  });
  it("counts and filters without merging records that share a title", () => {
    const rows = [{ id: 1, title: "Maths", source_type: "school" }, { id: 2, title: "Maths", source_type: "family" }, { id: 3, title: "Science" }];
    expect(countBySource(rows)).toEqual({ all: 3, school: 2, family: 1 });
    expect(filterBySource(rows, "family").map((r) => r.id)).toEqual([2]);
    expect(filterBySource(rows, "school").map((r) => r.id)).toEqual([1, 3]);
    expect(filterBySource(rows, "all")).toHaveLength(3);
  });
});
