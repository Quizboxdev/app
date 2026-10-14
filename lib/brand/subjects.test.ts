import { describe, expect, it } from "vitest";
import { subjectHue, subjectSlug } from "./subjects";
import { SUBJECT_VISUALS } from "./subject-visuals";
import fs from "node:fs";
import path from "node:path";

describe("subject logos", () => {
  it("maps every curriculum spelling to one slug, ignoring case, '&' and 'and'", () => {
    expect(subjectSlug("FRENCH")).toBe("french");
    expect(subjectSlug("English")).toBe("english-language");
    expect(subjectSlug("English Language")).toBe("english-language");
    expect(subjectSlug("Physical Education & Health (Core)")).toBe("physical-education");
    expect(subjectSlug("Physical Education and Health")).toBe("physical-education");
    expect(subjectSlug("Religious And Moral Education")).toBe("religious-and-moral-education");
    expect(subjectSlug("Creative Arts and Design")).toBe("creative-arts");
  });
  it("returns null for an unknown or empty subject so the UI shows the letter tile", () => {
    expect(subjectSlug("Underwater Basket Weaving")).toBeNull();
    expect(subjectSlug("")).toBeNull();
    expect(subjectSlug(null)).toBeNull();
  });
  it("has unique slugs and no alias claimed by two subjects", () => {
    const slugs = SUBJECT_VISUALS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of SUBJECT_VISUALS) expect(subjectSlug(s.label)).toBe(s.slug);
  });
  it("keeps the generated TypeScript list in step with docs/brand/subject-logos.json", () => {
    const file = JSON.parse(fs.readFileSync(path.join(__dirname, "../../docs/brand/subject-logos.json"), "utf8")) as { slug: string }[];
    expect(file.map((f) => f.slug)).toEqual(SUBJECT_VISUALS.map((s) => s.slug));
  });
  it("gives a stable colour", () => { expect(subjectHue("Mathematics")).toBe(subjectHue("Mathematics")); });
});
