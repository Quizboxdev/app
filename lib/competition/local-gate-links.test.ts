import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Pages behind sponsorEngineEnabled() 404 in production. Any link to them outside those pages (and the components only they
// render) must sit on a line that checks the sponsorEngine flag, so production navigation never leads to a 404.
const GATED = /["'`]\/(admin\/competitions\/(assignments|oversight)|sponsor\/workspace|competition\/(participate|attempt|results))\b/;
const GATED_OWNERS = /^(app\/\(app\)\/(admin\/competitions\/(assignments|oversight)|sponsor\/workspace|competition\/(participate|attempt|results))\/|components\/(CompetitionParticipation|SponsorCompetitionDelivery|SponsorWorkspace|SponsorCompetitionOversight|CompetitionReviewAssignments)\.tsx$|app\/\(app\)\/student\/attempt\/)/;
// student/attempt is also mounted by the gated competition/attempt route; its competition path is only built when already there.
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
});

describe("links to sponsor-engine pages", () => {
  it("are only rendered when the engine is enabled", () => {
    const offenders = [...files("app"), ...files("components")].map((path) => path.replace(/\\/g, "/"))
      .filter((path) => !GATED_OWNERS.test(path))
      .flatMap((path) => readFileSync(path, "utf8").split(/\r?\n/).map((line, i) => ({ path, line, n: i + 1 })))
      .filter(({ line }) => GATED.test(line) && !/sponsorEngine/.test(line))
      .map(({ path, n, line }) => `${path}:${n}: ${line.trim().slice(0, 120)}`);
    expect(offenders).toEqual([]);
  });
});
