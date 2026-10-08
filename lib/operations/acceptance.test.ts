import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptanceAccount, applyLocalEnvironmentSafely } from "./acceptance";
import { acceptancePassword, assertNotProduction, PRODUCTION_PROJECT_REF } from "./safety";
import { releaseBlocked, releaseGates } from "./release";
const environment = { QB_ENVIRONMENT: "acceptance", QB_ACCEPTANCE_PROJECT_REF: "unit", NEXT_PUBLIC_SUPABASE_URL: "https://unit.supabase.co",
 QB_ACCEPTANCE_STUDENT_EMAIL: "student.test@quizbox.local", QB_ACCEPTANCE_STUDENT_PASSWORD: "unit-only-credential" };
describe("acceptance credentials and release boundaries", () => {
 it("requires environment-supplied account identifiers and passwords", () => expect(acceptanceAccount("student", environment)).toEqual({ email: environment.QB_ACCEPTANCE_STUDENT_EMAIL, password: environment.QB_ACCEPTANCE_STUDENT_PASSWORD }));
 it("rejects missing configured email", () => expect(() => acceptanceAccount("student", { ...environment, QB_ACCEPTANCE_STUDENT_EMAIL: "" })).toThrow());
 it("rejects missing configured password", () => expect(() => acceptanceAccount("student", { ...environment, QB_ACCEPTANCE_STUDENT_PASSWORD: "" })).toThrow());
 it("never falls back to legacy/shared credentials after rotation", () => expect(() => acceptanceAccount("student", { ...environment, QB_ACCEPTANCE_ROTATED: "1", QB_ACCEPTANCE_STUDENT_PASSWORD: undefined, QUIZBOX_STUDENT_PASSWORD: "old-unit-only", QB_ACCEPTANCE_PASSWORD: "old-unit-only" })).toThrow());
 it("does not accept production account identities", () => expect(() => acceptanceAccount("student", { ...environment, QB_ACCEPTANCE_STUDENT_EMAIL: "real-user@example.invalid" })).toThrow());
 it.each([{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }, { QB_ENVIRONMENT: "production" }, { QB_PRODUCTION_PROJECT_REF: "unit" }])("refuses production context %j", flags => expect(() => acceptanceAccount("student", { ...environment, ...flags })).toThrow());
 it("supports per-role rotated secrets instead of a shared password", () => {
  const teacher = { ...environment, QB_ACCEPTANCE_TEACHER_EMAIL: "teacher.test@quizbox.local", QB_ACCEPTANCE_TEACHER_PASSWORD: "different-unit-secret" };
  expect(acceptanceAccount("teacher", teacher).password).not.toBe(acceptanceAccount("student", teacher).password);
 });
 it.each(["leaked_password_protection", "test_credential_rotation", "backup_restore"])("keeps %s blocked without verification", id => {
  const gates = releaseGates({ approved: 45, anonUnexpected: 0, rlsDisabled: 0, signup: true, dependencyHigh: 0, applicationPassed: true, authenticatedPassed: true, credentialsPresent: true });
  expect(gates.find(g => g.id === id)?.status).not.toBe("PASS"); expect(releaseBlocked(gates)).toBe(true);
 });
 it("keeps production review as the default and provides all three next actions", async () => {
  const page = await readFile("app/(app)/admin/content/page.tsx", "utf8");
  expect(page).toContain('source: "production"');
  for (const label of ["Approve &amp; Next", "Reject &amp; Next", "Needs Revision &amp; Next", "Curriculum objective summary:", "Provenance:"]) expect(page).toContain(label);
 });
 it("guards restore target, archive integrity and transactional execution without destructive cleanup", async () => {
  const script = await readFile("scripts/restore-isolated.ps1", "utf8");
  for (const check of ["RESTORE_TARGET_IS_NOT_ISOLATED", "RESTORE_ARCHIVE_CHECKSUM_MISMATCH", "RESTORE_CONNECTION_OVERRIDE_NOT_ALLOWED", "--single-transaction"]) expect(script).toContain(check);
  expect(script).not.toContain("--clean");
 });
});

describe("acceptance can never target production", () => {
 const preview = { QB_ENVIRONMENT: "acceptance", QB_ACCEPTANCE_PROJECT_REF: "previewprojectref00", NEXT_PUBLIC_SUPABASE_URL: "https://previewprojectref00.supabase.co", QB_ACCEPTANCE_PASSWORD: "unit-only-credential" };
 const prod = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
 it("allows a non-production preview target", () => { expect(() => assertNotProduction(preview)).not.toThrow(); expect(acceptancePassword(preview)).toBe("unit-only-credential"); });
 it.each([
  ["the production URL, even when no production ref is declared", { ...preview, NEXT_PUBLIC_SUPABASE_URL: prod }],
  ["the production URL declared as the acceptance ref", { ...preview, NEXT_PUBLIC_SUPABASE_URL: prod, QB_ACCEPTANCE_PROJECT_REF: PRODUCTION_PROJECT_REF }],
  ["a production SUPABASE_URL", { ...preview, SUPABASE_URL: prod }],
  ["a pooler/database value embedding the production ref", { ...preview, PREVIEW_DB_USER: `postgres.${PRODUCTION_PROJECT_REF}` }],
  ["an operator-declared production ref equal to the target", { ...preview, QB_PRODUCTION_PROJECT_REF: "previewprojectref00" }],
 ])("refuses %s", (_name, env) => {
  expect(() => assertNotProduction(env)).toThrow("ACCEPTANCE_PRODUCTION_TARGET_REFUSED");
  expect(() => acceptancePassword(env)).toThrow();
 });
 it("lets preview values win over .env.local and shields production secrets from later loads", () => {
  const dir = mkdtempSync(join(tmpdir(), "qb-env-")), file = join(dir, ".env.local");
  writeFileSync(file, `NEXT_PUBLIC_SUPABASE_URL=${prod}
SUPABASE_SERVICE_ROLE_KEY=prod-service-key
QB_PRODUCTION_PROJECT_REF=${PRODUCTION_PROJECT_REF}
UNRELATED_SETTING=kept
`);
  const saved = Object.fromEntries(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "UNRELATED_SETTING", "QB_PRODUCTION_PROJECT_REF"].map(k => [k, process.env[k]]));
  try {
   process.env.NEXT_PUBLIC_SUPABASE_URL = preview.NEXT_PUBLIC_SUPABASE_URL;
   for (const k of ["SUPABASE_SERVICE_ROLE_KEY", "UNRELATED_SETTING", "QB_PRODUCTION_PROJECT_REF"]) delete process.env[k];
   applyLocalEnvironmentSafely(file);
   expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe(preview.NEXT_PUBLIC_SUPABASE_URL); // preview wins
   expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe("");                              // production key never inherited
   expect(process.env.QB_PRODUCTION_PROJECT_REF).toBe("");
   expect(process.env.UNRELATED_SETTING).toBe("kept");                                  // harmless defaults still apply
   process.loadEnvFile(file);                                                            // what child scripts do afterwards
   expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe("");
   expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe(preview.NEXT_PUBLIC_SUPABASE_URL);
  } finally {
   for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
   rmSync(dir, { recursive: true, force: true });
  }
 });
 it("entry points load preview values first, never read .env.local directly, and carry no embedded credentials", async () => {
  for (const file of ["scripts/run-acceptance.ts", "scripts/reset-passwords.ts"]) {
   const source = await readFile(file, "utf8");
   expect(source, file).toContain("loadAcceptanceEnvironment");
   expect(source, file).toContain("applyLocalEnvironmentSafely");
   expect(source, file).toContain("assertNotProduction");
   expect(source, file).not.toMatch(/loadEnvFile\(\s*["']\.env\.local["']\s*\)/);
   expect(source, file).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\./);
   expect(source, file).not.toContain("Quixbox123");
  }
 });
 it("the live acceptance runner and fixture helper are Preview-only, self-provisioning and credential-free", async () => {
  const runner = await readFile("scripts/run-live-acceptance.ts", "utf8");
  const fixture = await readFile("lib/operations/live-fixture.ts", "utf8");
  expect(runner).toContain("resolveTarget");
  expect(runner).not.toMatch(/acceptanceAccount|loadEnvFile|\.env\.local/);
  for (const [name, source] of [["runner", runner], ["fixture", fixture]] as const) {
   expect(source, name).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\./);
   expect(source, name).not.toContain("Quixbox123");
  }
  expect(fixture).toContain("assertNotProduction");
  expect(fixture).toContain("FIXTURE_PRODUCTION_TARGET_REFUSED");
  expect(fixture).not.toMatch(/readFileSync\(\s*["']\.env\.local["']/);
  expect(fixture).not.toMatch(/legacy_content_attributions\s+(disable|enable)\s+trigger|disable trigger|session_replication_role/i);
 });
});
