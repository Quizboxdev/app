// Browser-safe part of the managed-learner sign-in identity (no Node crypto here, so the sign-in form can import it).
// A child has no email: their username stands in for it, as the local part of an address on a domain QuizBox controls. Nothing is ever sent there.
export const MANAGED_EMAIL_DOMAIN = "learners.quizbox.io";

// What a person types on the sign-in screen becomes the account email: a real address stays as it is, a bare username gets the managed domain.
export function usernameToEmail(input: string): string {
  const v = input.trim().toLowerCase();
  return v.includes("@") ? v : `${v}@${MANAGED_EMAIL_DOMAIN}`;
}
export const isManagedEmail = (email: string) => email.toLowerCase().endsWith(`@${MANAGED_EMAIL_DOMAIN}`);
