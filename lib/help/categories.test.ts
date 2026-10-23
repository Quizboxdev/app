import { describe, expect, it } from "vitest";
import { audienceForRole, categoryLabel, HELP_CATEGORIES, withoutTitleLine } from "./categories";

describe("help helpers", () => {
  it("picks the guides for a role, and none for an administrator or an unknown role", () => {
    expect(audienceForRole("STUDENT")).toBe("student"); expect(audienceForRole("teacher")).toBe("teacher"); expect(audienceForRole("SPONSOR")).toBe("sponsor");
    expect(audienceForRole("ADMIN")).toBeNull(); expect(audienceForRole("OWNER")).toBeNull(); expect(audienceForRole(undefined)).toBeNull();
  });
  it("labels every category the database allows", () => {
    expect(HELP_CATEGORIES.map((c) => c.id)).toEqual(["getting-started", "practise", "classes", "assignments", "challenges", "payments", "account", "safety"]);
    expect(categoryLabel("payments")).toBe("Payments and refunds"); expect(categoryLabel("unknown")).toBe("unknown");
  });
  it("drops the guide's own title line but nothing else", () => {
    expect(withoutTitleLine("# Create a class\n\nA class is a group.\n\n## Steps")).toBe("A class is a group.\n\n## Steps");
    expect(withoutTitleLine("A class is a group.\n\n# Not first")).toBe("A class is a group.\n\n# Not first");
  });
});
