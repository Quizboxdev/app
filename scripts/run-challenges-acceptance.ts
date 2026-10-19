import { spawnSync } from "node:child_process";
import { resolveTarget } from "../lib/operations/live-fixture";

// Runs the Challenges journey against Preview only (resolveTarget refuses production before anything is created).
// Apply migrations 20261021100000 and 20261022100000 to Preview first; then: npm run acceptance:challenges
try { resolveTarget(); } catch (e) { console.error("CHALLENGES_ACCEPTANCE_UNAVAILABLE", e instanceof Error ? e.message : ""); process.exit(1); }
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "lib/challenges/challenges.live.test.ts"], { stdio: "inherit", env: { ...process.env, QB_LIVE_ACCEPTANCE: "1" } });
process.exit(result.status ?? 1);
