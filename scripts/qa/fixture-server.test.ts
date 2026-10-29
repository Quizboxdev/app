import { describe, expect, it } from "vitest";
import { startFixtureServer, type QaFixture } from "./fixture-server";

const fixture: QaFixture = { role: "student", user: { id: "00000000-0000-4000-8000-000000000001", email: "test@qa.example.invalid" }, tables: {}, routes: ["/guides"], rpc: { async_read: async () => [{ id: "fixture" }], async_fail: async () => { throw new Error("TEST_FAILURE"); } } };
const urlOf = (server: Awaited<ReturnType<typeof startFixtureServer>>) => {
  const address = server.server.address();
  if (!address || typeof address === "string") throw new Error("QA server did not bind TCP");
  return `http://127.0.0.1:${address.port}`;
};
describe("local browser QA server", () => {
  it("establishes only a synthetic local session and awaits RPC results/errors", async () => {
    const server = await startFixtureServer(fixture, "http://localhost:3311", 0);
    try {
      const session = await fetch(`${urlOf(server)}/__qa/session`, { redirect: "manual" });
      expect(session.status).toBe(302);
      expect(session.headers.get("location")).toBe("http://localhost:3311/guides");
      expect(session.headers.get("set-cookie")?.startsWith("sb-127-auth-token=")).toBe(true);
      const read = await fetch(`${urlOf(server)}/rest/v1/rpc/async_read`, { method: "POST", body: "{}" });
      expect(await read.json()).toEqual([{ id: "fixture" }]);
      const failed = await fetch(`${urlOf(server)}/rest/v1/rpc/async_fail`, { method: "POST", body: "{}" });
      expect(failed.status).toBe(400);
      expect(await failed.json()).toEqual({ code: "P0001", message: "TEST_FAILURE" });
    } finally { await server.close(); }
  });
  it("does not issue a session or redirect for a non-loopback origin", async () => {
    const server = await startFixtureServer(fixture, "https://not-loopback.example.invalid", 0);
    try {
      const response = await fetch(`${urlOf(server)}/__qa/session`, { redirect: "manual" });
      expect(response.status).toBe(403);
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(response.headers.has("location")).toBe(false);
    } finally { await server.close(); }
  });
});
