// Release preflight. Read-only: inspects the repository and local status files; never connects to or
// mutates production. Exit code 1 when any check fails. Report: reports/release-preflight.json.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

type Check = { id: string; pass: boolean; detail: string };
const root = process.cwd(), checks: Check[] = [];
const add = (id: string, pass: boolean, detail: string) => checks.push({ id, pass, detail });
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const PRODUCTION_REF = "fmgccmqxfjppqydkhaiu";

// 1. Migration files: naming, unique versions, encoding, no stray backups.
const dir = path.join(root, "supabase/migrations"), files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const badNames = files.filter((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f));
add("migrations.naming", badNames.length === 0, badNames.length ? `Unexpected files: ${badNames.join(", ")}` : `${files.length} migration files`);
const versions = files.map((f) => f.slice(0, 14)), dupes = versions.filter((v, i) => versions.indexOf(v) !== i);
add("migrations.unique_versions", dupes.length === 0, dupes.length ? `Duplicate versions: ${[...new Set(dupes)].join(", ")}` : "All versions unique");
const bom = files.filter((f) => readFileSync(path.join(dir, f)).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
add("migrations.no_bom", bom.length === 0, bom.length ? `BOM in: ${bom.join(", ")}` : "No byte-order marks");

// 2. Expected activation set present, in order.
const checklist = existsSync(path.join(root, "docs/production-activation-checklist.md")) ? read("docs/production-activation-checklist.md") : "";
const expected = ["20261002200000", "20261002210000", "20261002220000", "20261002230000", "20261002240000", "20261002250000", "20261002260000", "20261002270000", "20261002280000",
  "20261003100000", "20261003110000", "20261003120000", "20261003130000", "20261003140000", "20261003150000", "20261003160000", "20261003170000", "20261003180000", "20261003190000", "20261003200000",
  "20261004100000", "20261004110000", "20261004120000", "20261005100000"];
const missing = expected.filter((v) => !versions.includes(v));
add("migrations.activation_set_present", missing.length === 0, missing.length ? `Missing: ${missing.join(", ")}` : `${expected.length} activation migrations present`);
const undocumented = expected.filter((v) => !checklist.includes(v.slice(8)) && !checklist.includes(v));
add("docs.activation_order_lists_all", undocumented.length === 0, undocumented.length ? `Not in checklist: ${undocumented.join(", ")}` : "Checklist lists every activation migration");

// 3. Production target explicitly identified and hard-blocked for branch-only features.
add("target.production_identified", checklist.includes(PRODUCTION_REF) && read("docs/production-migration-reconciliation.md").includes(PRODUCTION_REF), `Production ref ${PRODUCTION_REF} named in activation docs`);
add("target.local_gate_blocks_production", read("lib/competition/local-gate.ts").includes(`"${PRODUCTION_REF}"`), "Sponsor engine gate hard-blocks the production ref");

// 4. Required environment variables (presence only; values never read into the report).
const envFiles = [".env.local", ".env.production", ".env"].filter((f) => existsSync(path.join(root, f)));
const envText = envFiles.map(read).join("\n") + "\n" + Object.keys(process.env).map((k) => `${k}=`).join("\n");
const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const absent = required.filter((k) => !new RegExp(`^${k}=`, "m").test(envText));
add("env.required_present", absent.length === 0, absent.length ? `Missing: ${absent.join(", ")}` : `Present: ${required.join(", ")}`);
const exampleText = existsSync(path.join(root, ".env.example")) ? read(".env.example") : "";
add("env.example_documents_required", required.every((k) => exampleText.includes(k)), ".env.example documents required variables");

// 5. Build/test status from the last `npm run release:validate`.
const statusPath = path.join(root, "reports/validation-status.json");
if (existsSync(statusPath)) {
  const status = JSON.parse(readFileSync(statusPath, "utf8")) as { at: string; steps: Record<string, { pass: boolean }> };
  const failed = Object.entries(status.steps).filter(([, v]) => !v.pass).map(([k]) => k);
  const newest = files.map((f) => statSync(path.join(dir, f)).mtimeMs).reduce((a, b) => Math.max(a, b), 0);
  add("validation.status_pass", failed.length === 0, failed.length ? `Failed: ${failed.join(", ")}` : `All steps passed at ${status.at}`);
  add("validation.status_current", Date.parse(status.at) >= newest, Date.parse(status.at) >= newest ? "Validation newer than all migrations" : "Migrations changed after the last validation run");
} else add("validation.status_pass", false, "Run npm run release:validate first");

// 6. Activation documentation present.
const docs = ["docs/production-activation-checklist.md", "docs/production-migration-reconciliation.md", "docs/security-release-review.md", "docs/new-market-launch-playbook.md", "docs/release-data-verification.md", "scripts/release-data-verification.sql"];
const noDocs = docs.filter((d) => !existsSync(path.join(root, d)));
add("docs.present", noDocs.length === 0, noDocs.length ? `Missing: ${noDocs.join(", ")}` : `${docs.length} activation documents present`);

// 7. No branch-only fixture leakage into migrations or tracked files.
const leak = [/testland/i, /\bTL-CORE\b/, /TESTLAND_FIXTURE/, /e2e\.quizbox\.invalid/, /insert into public\.feature_flags[^;]*TEST_MARKETS_VISIBLE[^;]*true/i, /fngdtxayfoiffbcbmcum/];
const leaking = files.filter((f) => leak.some((re) => re.test(read(`supabase/migrations/${f}`))));
add("data.no_fixture_in_migrations", leaking.length === 0, leaking.length ? `Fixture markers in: ${leaking.join(", ")}` : "No test-market, fixture or branch markers in migrations");
let tracked = "";
try { tracked = execSync("git ls-files", { cwd: root, encoding: "utf8" }); } catch { tracked = ""; }
const trackedSecrets = tracked.split("\n").filter((f) => /^\.env(\.|$)/.test(f) && f !== ".env.example" && f !== ".env.batch2.example");
add("data.no_tracked_env_files", trackedSecrets.length === 0, trackedSecrets.length ? `Tracked env files: ${trackedSecrets.join(", ")}` : "No environment files tracked by git");

const pass = checks.every((c) => c.pass);
writeFileSync(path.join(root, "reports/release-preflight.json"), JSON.stringify({ at: new Date().toISOString(), production_ref: PRODUCTION_REF, mutates_production: false, pass, checks }, null, 2) + "\n");
for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.id.padEnd(38)} ${c.detail}`);
console.log(pass ? "\nRELEASE PREFLIGHT: PASS" : "\nRELEASE PREFLIGHT: FAIL");
process.exitCode = pass ? 0 : 1;
