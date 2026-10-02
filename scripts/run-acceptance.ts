import { spawnSync } from "node:child_process";
import { acceptanceAccount, ACCEPTANCE_ROLES, loadAcceptanceEnvironment } from "../lib/operations/acceptance";

try {
 process.loadEnvFile(".env.local");
 loadAcceptanceEnvironment();
 const student = acceptanceAccount("student");
 process.env.QB_ACCEPTANCE_PASSWORD ??= student.password;
 const accounts = ACCEPTANCE_ROLES.map(role => acceptanceAccount(role));
 const admin = accounts[0];
 const command = process.argv[2];
 if (!["release:check", "test", "content:wave:import"].includes(command)) throw new Error("ACCEPTANCE_COMMAND_NOT_ALLOWED");
 const result = spawnSync(process.platform === "win32" ? "cmd.exe" : "npm",
  process.platform === "win32" ? ["/d", "/s", "/c", "npm.cmd run " + command + (command === "content:wave:import" && process.argv.includes("--apply") ? " -- --apply" : "")]
   : ["run", command, ...(command === "content:wave:import" && process.argv.includes("--apply") ? ["--", "--apply"] : [])],
  { stdio: "inherit", env: { ...process.env, QB_ACCEPTANCE_PASSWORD: process.env.QB_ACCEPTANCE_PASSWORD ?? student.password,
    QB_CONTENT_OPERATOR_EMAIL: admin.email, QB_CONTENT_OPERATOR_PASSWORD: admin.password, QB_LIVE_ACCEPTANCE: "1" } });
 process.exitCode = result.status ?? 1;
} catch { console.error("ACCEPTANCE_ENVIRONMENT_OR_ACCOUNT_CONFIGURATION_REQUIRED: use ignored local environment files; never production"); process.exitCode = 1; }
