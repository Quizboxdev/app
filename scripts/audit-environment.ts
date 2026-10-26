import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { auditEnvironment } from "../lib/operations/environment-audit";

const args = process.argv.slice(2);
const target = args[args.indexOf("--target") + 1];
if (!args.includes("--target") || !["preview", "production", "local"].includes(target)) throw new Error("Use --target preview|production|local and optionally --file <path>. No environment is inferred.");
const modeIndex = args.indexOf("--payment-mode");
const paymentMode = modeIndex >= 0 ? args[modeIndex + 1] : "test";
if (paymentMode !== "test" && paymentMode !== "live") throw new Error("PAYMENT_MODE_MUST_BE_TEST_OR_LIVE");
const fileIndex = args.indexOf("--file");
if (fileIndex >= 0 && !args[fileIndex + 1]) throw new Error("ENV_FILE_REQUIRED");
// An explicit file is isolated from the shell environment, preventing production credentials from leaking into Preview checks.
const env = fileIndex >= 0 ? parseEnv(readFileSync(args[fileIndex + 1], "utf8")) : process.env;
const report = auditEnvironment(env, target as "preview" | "production" | "local", args.includes("--require-operations"), paymentMode);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
