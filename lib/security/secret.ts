import { createHash, timingSafeEqual } from "node:crypto";

// Compares a secret from a request with the expected one without leaking, through timing, how much of it was right. Both sides are hashed first so the lengths always match (and the length is not leaked either).
export function secretMatches(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected || !provided) return false;
  const a = createHash("sha256").update(provided).digest(), b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
