import { SUBJECT_VISUALS } from "./subject-visuals";
import { subjectSlug } from "./subjects";

// Q-Insignia subject photography registry (Knowledge Window v0.2).
// One record per subject family, keyed by the existing logo slug from docs/brand/subject-logos.json — this file never adds a
// subject identity of its own. A photo is shown only when its status allows it:
//   approved  -> shown whenever the subject cards are on
//   concept   -> shown only where concept photos are explicitly allowed (review / staging flag), never by default
//   anything else, or no record -> the card uses the existing letter-tile fallback (PHOTO_UNAVAILABLE), which says nothing
//   about whether the subject has questions.
export type AssetStatus = "approved" | "concept" | "pending" | "rejected";
export type RightsStatus = "cleared" | "pending" | "refused";

export type SubjectPhotoRecord = {
  subjectId: string;          // same as canonicalSlug: the taxonomy's own key
  canonicalSlug: string;      // slug in SUBJECT_VISUALS
  displayName: string;        // label in SUBJECT_VISUALS (curriculum titles keep their own spelling on screen)
  category: "languages" | "mathematics" | "sciences" | "technology" | "humanities" | "arts";
  applicableGrades: string[]; // levels from docs/brand/subject-logos.json (P, JHS, SHS); availability still comes from the practice menu
  discoveryImage: { webp: string; jpg: string; width: 960; height: 600 };
  mobileImage: { webp: string; jpg: string; width: 640; height: 640 };
  focalPoint: string;         // CSS object-position for responsive cropping inside the 8:5 / 1:1 frames
  altText: string;            // for places where the photo stands alone; inside a card the title names the subject, so alt is ""
  assetVersion: string;
  assetStatus: AssetStatus;
  rightsStatus: RightsStatus;
  sourceSlug?: string;        // the slug used in the delivery package when it differs from the canonical one
};

const BASE = "/brand/subjects/photos/concept-v0.2";
const files = (slug: string) => ({
  discoveryImage: { webp: `${BASE}/${slug}-discovery-960x600.webp`, jpg: `${BASE}/${slug}-discovery-960x600.jpg`, width: 960 as const, height: 600 as const },
  mobileImage: { webp: `${BASE}/${slug}-mobile-640x640.webp`, jpg: `${BASE}/${slug}-mobile-640x640.jpg`, width: 640 as const, height: 640 as const },
});
const label = (slug: string) => SUBJECT_VISUALS.find((s) => s.slug === slug)?.label ?? slug;

type Seed = Pick<SubjectPhotoRecord, "canonicalSlug" | "category" | "applicableGrades" | "focalPoint" | "altText"> & { sourceSlug?: string };
// QuizBox_Q-Insignia_Subject-Photography_v0.2 supplied assets; the user confirmed rights and approved all eight for use.
const SEEDS: Seed[] = [
  { canonicalSlug: "english-language", category: "languages", applicableGrades: ["P", "JHS", "SHS"], focalPoint: "62% 55%", altText: "A student writes in a notebook with a fountain pen beside an open book on a wooden classroom desk." },
  { canonicalSlug: "computing", category: "technology", applicableGrades: ["P", "JHS", "SHS"], focalPoint: "60% 50%", altText: "A student types code on a laptop in a school computer lab next to a single-board computer and breadboard." },
  { canonicalSlug: "religious-and-moral-education", category: "humanities", applicableGrades: ["P", "JHS", "SHS"], focalPoint: "50% 50%", altText: "Students and a teacher sort donated books into crates at a community library." },
  { canonicalSlug: "career-technology", category: "technology", applicableGrades: ["JHS"], focalPoint: "40% 50%", altText: "A student measures a wooden joint with vernier calipers on a workshop bench." },
  { canonicalSlug: "creative-arts", category: "arts", applicableGrades: ["P", "JHS"], focalPoint: "40% 50%", sourceSlug: "creative-arts-and-design", altText: "A student paints on a canvas at an easel in a school art studio, with a palette, sketchbook and clay pot." },
  { canonicalSlug: "mathematics", category: "mathematics", applicableGrades: ["P", "JHS", "SHS"], focalPoint: "40% 55%", altText: "A hand draws an arc with a metal compass on graph paper beside a protractor and set square." },
  { canonicalSlug: "science", category: "sciences", applicableGrades: ["P", "JHS", "SHS"], focalPoint: "35% 45%", altText: "A student in goggles and gloves pours a blue solution into a flask in a school laboratory." },
  { canonicalSlug: "social-studies", category: "humanities", applicableGrades: ["JHS", "SHS"], focalPoint: "40% 50%", altText: "Students with a teacher take notes and water samples beside a community river." },
];

export const SUBJECT_PHOTOS: readonly SubjectPhotoRecord[] = Object.freeze(SEEDS.map((s) => ({
  subjectId: s.canonicalSlug, canonicalSlug: s.canonicalSlug, displayName: label(s.canonicalSlug), category: s.category, applicableGrades: s.applicableGrades,
  ...files(s.canonicalSlug), focalPoint: s.focalPoint, altText: s.altText, assetVersion: "0.2", assetStatus: "approved" as AssetStatus, rightsStatus: "cleared" as RightsStatus,
  ...(s.sourceSlug ? { sourceSlug: s.sourceSlug } : {}),
})));

const BY_SLUG = new Map(SUBJECT_PHOTOS.map((r) => [r.canonicalSlug, r]));

export function photoRecord(slug: string | null | undefined): SubjectPhotoRecord | null {
  return slug ? BY_SLUG.get(slug) ?? null : null;
}

// The photo to show for a subject name as the curriculum spells it, or null for the fallback tile.
export function subjectPhoto(name: string | null | undefined, opts: { allowConcept: boolean }): SubjectPhotoRecord | null {
  const record = photoRecord(subjectSlug(name));
  if (!record) return null;
  if (record.assetStatus === "approved" && record.rightsStatus === "cleared") return record;
  if (record.assetStatus === "concept" && record.rightsStatus === "cleared" && opts.allowConcept) return record;
  return null;
}
