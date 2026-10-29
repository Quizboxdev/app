import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { SUBJECT_PHOTOS, photoRecord, subjectPhoto } from "./subject-photography";
import { SUBJECT_VISUALS } from "./subject-visuals";

const PUBLIC = path.join(__dirname, "../../public");

describe("Q-Insignia subject photography registry", () => {
  it("holds the 8 pilot subjects, each keyed by an existing taxonomy slug (no parallel identities)", () => {
    expect(SUBJECT_PHOTOS.map((r) => r.canonicalSlug).sort()).toEqual(
      ["career-technology", "computing", "creative-arts", "english-language", "mathematics", "religious-and-moral-education", "science", "social-studies"]);
    for (const r of SUBJECT_PHOTOS) {
      const visual = SUBJECT_VISUALS.find((s) => s.slug === r.canonicalSlug);
      expect(visual, r.canonicalSlug).toBeTruthy();
      expect(r.displayName).toBe(visual!.label);
      expect(r.subjectId).toBe(r.canonicalSlug);
    }
  });

  it("keeps concept assets out of production: nothing is approved or rights-cleared yet", () => {
    for (const r of SUBJECT_PHOTOS) { expect(r.assetStatus).toBe("concept"); expect(r.rightsStatus).toBe("pending"); expect(r.assetVersion).toBe("0.2"); }
    expect(subjectPhoto("Mathematics", { allowConcept: false })).toBeNull();
    expect(subjectPhoto("Mathematics", { allowConcept: true })?.canonicalSlug).toBe("mathematics");
  });

  it("resolves curriculum spellings through the existing aliases and falls back for unknown or unphotographed subjects", () => {
    expect(subjectPhoto("Creative Arts and Design", { allowConcept: true })?.canonicalSlug).toBe("creative-arts");
    expect(photoRecord("creative-arts")?.sourceSlug).toBe("creative-arts-and-design");
    expect(subjectPhoto("English", { allowConcept: true })?.canonicalSlug).toBe("english-language");
    expect(subjectPhoto("French", { allowConcept: true })).toBeNull();          // real subject, no photo yet
    expect(subjectPhoto("Integrated Science", { allowConcept: true })).toBeNull(); // not an alias today: fallback, not a guess
    expect(subjectPhoto(null, { allowConcept: true })).toBeNull();
  });

  it("ships every referenced file at its native size and format (no stretched or collage crops)", async () => {
    for (const r of SUBJECT_PHOTOS) {
      for (const [img, w, h] of [[r.discoveryImage, 960, 600], [r.mobileImage, 640, 640]] as const) {
        for (const [file, format] of [[img.webp, "webp"], [img.jpg, "jpeg"]] as const) {
          const full = path.join(PUBLIC, file);
          expect(fs.existsSync(full), file).toBe(true);
          const meta = await sharp(full).metadata();
          expect([meta.width, meta.height, meta.format], file).toEqual([w, h, format]);
          expect(fs.statSync(full).size, file).toBeLessThan(130 * 1024);
        }
      }
      expect(r.altText.length).toBeGreaterThan(20);
      expect(r.focalPoint).toMatch(/^\d{1,3}% \d{1,3}%$/);
    }
  });
});
