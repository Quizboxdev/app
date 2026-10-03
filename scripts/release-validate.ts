// Runs the release validation steps and records their status for release:preflight.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const steps: Array<[string, string]> = [["typecheck", "npx tsc --noEmit"], ["lint", "npx eslint ."], ["test", "npx vitest run"], ["build", "npx next build"]];
const result: Record<string, { pass: boolean; seconds: number }> = {};
for (const [name, command] of steps) {
  const started = Date.now();
  const run = spawnSync(command, { shell: true, stdio: "inherit" });
  result[name] = { pass: run.status === 0, seconds: Math.round((Date.now() - started) / 1000) };
  console.log(`${result[name].pass ? "PASS" : "FAIL"} ${name} (${result[name].seconds}s)`);
}
writeFileSync("reports/validation-status.json", JSON.stringify({ at: new Date().toISOString(), steps: result }, null, 2) + "\n");
process.exitCode = Object.values(result).every((s) => s.pass) ? 0 : 1;
