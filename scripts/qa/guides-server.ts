// Local-only authenticated Guides QA. Never contacts a hosted Supabase project.
// Visit http://localhost:54399/__qa/session to establish the synthetic session.
import { spawn } from "node:child_process";
import { FIXTURE_URL, startFixtureServer } from "./fixture-server";
import { buildGuidesFixture } from "./fixtures/guides";

async function main() {
  const fixture = await startFixtureServer(buildGuidesFixture(), "http://localhost:3311");
  const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", "3311"], { stdio: "inherit", env: { ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: FIXTURE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "qa-fixture-anon-key", SUPABASE_SERVICE_ROLE_KEY: "qa-fixture-service-key", NEXT_TELEMETRY_DISABLED: "1",
  } });
  const stop = async () => { next.kill(); await fixture.close(); process.exit(); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
main().catch(() => { console.error("Local Guides QA server failed to start"); process.exitCode = 1; });
