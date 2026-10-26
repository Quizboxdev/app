import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
describe("Vercel framework contract", () => {
  it("uses the Next.js adapter so middleware is compiled rather than served as raw source", () => {
    expect(config.framework).toBe("nextjs");
    expect(config.buildCommand).toBe("npm run build");
    expect(config.outputDirectory).toBeUndefined();
    expect(config.builds).toBeUndefined();
  });
  it("retains the managed-erasure schedule", () => expect(config.crons).toContainEqual({ path: "/api/cron/managed-erasure", schedule: "0 3 * * 1" }));
});
