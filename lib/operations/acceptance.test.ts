import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { acceptanceAccount } from "./acceptance";
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
