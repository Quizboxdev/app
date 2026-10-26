// Local-only browser QA server. No hosted Supabase or real credentials are used.
// QA_HELP_SCENARIO: off, empty, error, or omitted for the populated flagged UI.
import { spawn } from "node:child_process";
import { FIXTURE_URL, startFixtureServer } from "./fixture-server";
import { buildHelpFixture } from "./fixtures/help";

const port = 3311;
async function main() {
const fixture = await startFixtureServer(buildHelpFixture(), `http://localhost:${port}`);
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)], { stdio: "inherit", env: { ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: FIXTURE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "qa-fixture-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "qa-fixture-service-key",
  NEXT_TELEMETRY_DISABLED: "1",
} });
const stop = async () => { next.kill(); await fixture.close(); process.exit(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
}
main().catch(() => { console.error("Local Help QA server failed to start"); process.exitCode = 1; });
