import { acceptancePassword } from "./safety";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
export const ACCEPTANCE_ROLES = ["admin", "student", "student2", "teacher", "sponsor", "seller"] as const;
export type AcceptanceRole = typeof ACCEPTANCE_ROLES[number];
export function loadAcceptanceEnvironment() {
 if (process.env.QB_ENVIRONMENT !== "acceptance" || process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") throw new Error("ACCEPTANCE_ENVIRONMENT_REQUIRED");
 for (const file of [".env.acceptance.local"]) {
  try { process.loadEnvFile(file); } catch (error: any) { if (error.code !== "ENOENT") throw new Error("ACCEPTANCE_CREDENTIAL_FILE_UNAVAILABLE"); }
 }
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
