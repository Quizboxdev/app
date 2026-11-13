import { describe, expect, it } from "vitest";
import { allShownChosen, clearShown, filterLearners, selectAllShown, toggleOne, type PickLearner } from "./learner-picker";

const L: PickLearner[] = [{ user_id: "a", name: "Ama Mensah" }, { user_id: "b", name: "Kofi Boateng" }, { user_id: "c", name: "Efua Amoah" }];

describe("learner picker", () => {
  it("search ignores case and spaces at the edges, and an empty search shows everyone", () => {
    expect(filterLearners(L, "  AM ").map((l) => l.user_id)).toEqual(["a", "c"]);
    expect(filterLearners(L, "").map((l) => l.user_id)).toEqual(["a", "b", "c"]);
    expect(filterLearners(L, "zzz")).toEqual([]);
  });

  it("toggling adds and removes one learner", () => {
    expect(toggleOne([], "a")).toEqual(["a"]);
    expect(toggleOne(["a", "b"], "a")).toEqual(["b"]);
  });

  it("Select all adds only the learners shown and never duplicates anyone", () => {
    const shown = filterLearners(L, "am");
    expect(selectAllShown(["a"], shown)).toEqual(["a", "c"]);
    expect(selectAllShown(["b"], shown)).toEqual(["b", "a", "c"]);
  });

  it("Clear removes only the learners shown, so earlier picks outside the search stay", () => {
    expect(clearShown(["a", "b", "c"], filterLearners(L, "am"))).toEqual(["b"]);
    expect(clearShown(["a", "b", "c"], L)).toEqual([]);
  });

  it("reports whether everyone shown is chosen, and is false for an empty list", () => {
    expect(allShownChosen(["a", "c"], filterLearners(L, "am"))).toBe(true);
    expect(allShownChosen(["a"], filterLearners(L, "am"))).toBe(false);
    expect(allShownChosen(["a"], [])).toBe(false);
  });
});
