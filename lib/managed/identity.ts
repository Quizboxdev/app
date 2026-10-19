import { randomInt } from "node:crypto";

// Sign-in identity for teacher-managed learners under 13. They have no email: a username stands in for it, and behind the scenes it is the local part of
// an address on a domain QuizBox controls (nothing is ever sent there). Passwords are generated, shown to the teacher once, and never stored by us.
export { MANAGED_EMAIL_DOMAIN, isManagedEmail, usernameToEmail } from "./username";
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";                 // no 0/o/1/l/i: easy to read off a printed card

const pick = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
export const asciiFold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

// first name + a short random tag, for example ama.k7f2. The tag makes a clash between two children named Ama very unlikely and is not guessable from the name.
export function generateUsername(firstName: string): string {
  const base = asciiFold(firstName).slice(0, 12) || "learner";
  return `${base}.${pick(4)}`;
}
// Eight characters in two groups, for example k7mx-p2qa. 31 possible characters each: about 40 bits, with sign-in attempts rate limited by the platform.
export const generatePassword = () => `${pick(4)}-${pick(4)}`;

export { NAME_PATTERN, parseNamesBrowser as parseNames, type ParsedNames } from "./names";
