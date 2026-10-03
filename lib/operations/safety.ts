export function acceptancePassword(env: Record<string,string|undefined> = process.env): string {
  if (env.QB_ENVIRONMENT !== "acceptance" || env.NODE_ENV === "production" || env.VERCEL_ENV === "production") throw new Error("ACCEPTANCE_ENVIRONMENT_REQUIRED");
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.local").hostname.split(".")[0];
  if (!env.QB_ACCEPTANCE_PROJECT_REF || ref !== env.QB_ACCEPTANCE_PROJECT_REF || ref === env.QB_PRODUCTION_PROJECT_REF) throw new Error("ACCEPTANCE_PROJECT_NOT_AUTHORIZED");
  if (!env.QB_ACCEPTANCE_PASSWORD) throw new Error("QB_ACCEPTANCE_PASSWORD_REQUIRED");
  return env.QB_ACCEPTANCE_PASSWORD;
}

export function fixtureMutationAllowed(env: Record<string,string|undefined>, args: string[], namespace: string) {
  acceptancePassword(env);
  if (!args.includes("--apply") || !args.includes("--confirm-fixtures") || !namespace.startsWith("DEV_ACCEPTANCE_FIXTURE")) throw new Error("EXPLICIT_FIXTURE_CONFIRMATION_REQUIRED");
}

export function sanitizedFailure(operation: string, code: unknown) {
  const allowed = ["ATTEMPT_COMPLETION", "ATTEMPT_START", "CLASS_JOIN", "GENERATION", "IMPORT", "REVIEW", "EXTRACTION", "SME_REVIEW", "PUBLICATION", "RESULT_PERSISTENCE", "ONBOARDING"];
  if (!allowed.includes(operation)) throw new Error("INVALID_OPERATION");
  const value = String(code);
  // Only canonical upper-case codes survive; free text (which could carry secrets or answers) is dropped.
  return { operation, code: /^[A-Z][A-Z0-9_]{2,60}$/.test(value) ? value : "OPERATION_FAILED" };
}
