import { NAME_PATTERN } from "@/lib/managed/names";

// What a parent types to add a child. Validated here (and again by the database) so a bad request never creates a sign-in.
export type ChildInput = { firstName: string; lastName: string; displayName: string; age: number; gradeCode: string; school: string };

const clean = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

export function parseChildInput(body: Record<string, unknown>): { ok: true; value: ChildInput } | { ok: false; error: string } {
  const firstName = clean(body.firstName), lastName = clean(body.lastName), displayName = clean(body.displayName), school = clean(body.school), gradeCode = clean(body.gradeCode);
  const age = typeof body.age === "number" ? body.age : Number(body.age);
  if (!NAME_PATTERN.test(firstName)) return { ok: false, error: "Enter the child's first name (letters, spaces, hyphens and apostrophes only)." };
  if (lastName && !NAME_PATTERN.test(lastName)) return { ok: false, error: "The last name can only use letters, spaces, hyphens and apostrophes." };
  if (displayName.length > 40 || /[<>@]/.test(displayName)) return { ok: false, error: "The display name is too long or has symbols that are not allowed." };
  if (!Number.isInteger(age) || age < 3 || age > 30) return { ok: false, error: "Enter the child's age as a whole number from 3 to 30." };
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(gradeCode)) return { ok: false, error: "Choose the child's class." };
  if (school.length > 200 || /[<>]/.test(school)) return { ok: false, error: "The school name is too long or has symbols that are not allowed." };
  if (body.consentConfirmed !== true) return { ok: false, error: "Confirm that you are this child's parent or guardian and agree to set up their account." };
  return { ok: true, value: { firstName, lastName, displayName, age, gradeCode, school } };
}
