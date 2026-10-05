import { acceptancePassword, assertNotProduction } from "./safety";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
export const ACCEPTANCE_ROLES = ["admin", "student", "student2", "teacher", "sponsor", "seller"] as const;
export type AcceptanceRole = typeof ACCEPTANCE_ROLES[number];
export function loadAcceptanceEnvironment() {
 // Preview-only values load FIRST. process.loadEnvFile never overrides a variable that is already set, so these win over .env.local.
 for (const file of [".env.acceptance.local"]) {
  try { process.loadEnvFile(file); } catch (error: any) { if (error.code !== "ENOENT") throw new Error("ACCEPTANCE_CREDENTIAL_FILE_UNAVAILABLE"); }
 }
 if (process.env.QB_ENVIRONMENT !== "acceptance" || process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") throw new Error("ACCEPTANCE_ENVIRONMENT_REQUIRED");
 assertNotProduction(process.env);
 if (existsSync(".env.acceptance.rotated.local")) {
  const rotated = parseEnv(readFileSync(".env.acceptance.rotated.local", "utf8"));
  if (rotated.QB_ACCEPTANCE_PROJECT_REF !== process.env.QB_ACCEPTANCE_PROJECT_REF) throw new Error("ROTATED_CREDENTIAL_PROJECT_MISMATCH");
  for (const role of ACCEPTANCE_ROLES) for (const field of ["EMAIL", "PASSWORD"]) {
   const key = `QB_ACCEPTANCE_${role.toUpperCase()}_${field}`;
   if (!rotated[key]) throw new Error("ROTATED_CREDENTIAL_SET_INCOMPLETE");
   process.env[key] = rotated[key];
  }
  process.env.QB_ACCEPTANCE_ROTATED = "1";
 }
}
// Connection and secret settings that must never be inherited from .env.local (production) by an acceptance run.
export const LOCAL_ENV_SHIELDED = /SUPABASE|DATABASE|POSTGRES|^PG|DB_|SERVICE_ROLE|MANAGEMENT_TOKEN|JWT|^QB_(ENVIRONMENT|PRODUCTION|ACCEPTANCE|CONTENT_OPERATOR)/i;
// Applies .env.local without letting it reach production: shielded keys the preview environment did not set are blanked
// (an empty value still counts as "already set", so later loadEnvFile calls in child scripts cannot fill them in); other keys fill gaps only.
export function applyLocalEnvironmentSafely(file = ".env.local", env: Record<string, string | undefined> = process.env) {
 let text = "";
 try { text = readFileSync(file, "utf8"); } catch (error: any) { if (error.code === "ENOENT") return; throw new Error("LOCAL_ENVIRONMENT_UNAVAILABLE"); }
 for (const [key, value] of Object.entries(parseEnv(text))) {
  if (key in env) continue;
  env[key] = LOCAL_ENV_SHIELDED.test(key) ? "" : value;
 }
}
export function acceptanceAccount(role: AcceptanceRole, env: Record<string, string | undefined> = process.env) {
 if (env === process.env) loadAcceptanceEnvironment();
 if (!ACCEPTANCE_ROLES.includes(role)) throw new Error("ACCEPTANCE_ACCOUNT_NOT_AUTHORIZED");
 const prefix = role.toUpperCase();
 const email = env[`QB_ACCEPTANCE_${prefix}_EMAIL`] ?? env[`QUIZBOX_${prefix}_EMAIL`];
 if (!email || email !== `${role}.test@quizbox.local`) throw new Error("ACCEPTANCE_EMAIL_ENVIRONMENT_REQUIRED");
 const password = env.QB_ACCEPTANCE_ROTATED === "1" ? env[`QB_ACCEPTANCE_${prefix}_PASSWORD`] : env[`QB_ACCEPTANCE_${prefix}_PASSWORD`] ?? env[`QUIZBOX_${prefix}_PASSWORD`] ?? env.QB_ACCEPTANCE_PASSWORD;
 return { email, password: acceptancePassword({ ...env, QB_ACCEPTANCE_PASSWORD: password }) };
}
export function acceptanceAccountPassword(email: string, env: Record<string, string | undefined> = process.env) {
 const role = /^(admin|student2?|teacher|sponsor|seller)\.test@quizbox\.local$/.exec(email)?.[1] as AcceptanceRole | undefined;
 if (!role) throw new Error("ACCEPTANCE_ACCOUNT_NOT_AUTHORIZED");
 const account = acceptanceAccount(role, env);
 if (account.email !== email) throw new Error("ACCEPTANCE_ACCOUNT_NOT_AUTHORIZED");
 return account.password;
}
