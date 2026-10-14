import { SUBJECT_VISUALS } from "./subject-visuals";

// Maps whatever spelling the curriculum or a practice set uses ("FRENCH", "English", "Physical Education & Health (Core)") to the one
// logo slug for that subject family. Unknown subjects return null and the UI shows a coloured letter tile instead of a broken image.
const norm = (v: string) => v.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\band\b/g, " ").replace(/\s+/g, " ").trim();
const INDEX = new Map<string, string>();
for (const s of SUBJECT_VISUALS) { INDEX.set(norm(s.label), s.slug); for (const a of s.aliases) INDEX.set(norm(a), s.slug); }

export function subjectSlug(name: string | null | undefined): string | null {
  const key = norm(String(name ?? ""));
  if (!key) return null;
  return INDEX.get(key) ?? null;
}

export const subjectLogoPath = (slug: string) => `/brand/subjects/${slug}.webp`;

const HUES = [217, 43, 142, 350, 222, 174] as const; // blue, gold, green, coral, navy, teal: the brand palette
// Stable colour for a subject so its tile never changes between visits.
export function subjectHue(name: string | null | undefined): number {
  const key = subjectSlug(name) ?? norm(String(name ?? ""));
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

export const subjectInitial = (name: string | null | undefined) => (String(name ?? "").trim().charAt(0) || "?").toUpperCase();
