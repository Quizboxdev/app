import type { QaFixture } from "../fixture-server";
import { buildTeacherFixture } from "./teacher";

// Teacher fixture with the Q-Insignia pilot flags on (Phase 3: "Subjects you teach" on Home and class cards in the assignment builder).
// QI_SCENARIO=flagoff keeps the flag off so the existing class select must render unchanged.
export function buildQiteacherFixture(now = Date.now()): QaFixture {
  const base = buildTeacherFixture(now);
  const flag = (key: string, value: boolean) => ({ key: `flags.${key}`, value, scope_type: "global", scope_id: null });
  const off = process.env.QI_SCENARIO === "flagoff";
  const builder = base.routes.find((r) => typeof r !== "string" && r.label === "builder-class");
  const path = typeof builder === "object" ? builder.path : "/teacher/assignments";
  return {
    ...base,
    routes: off ? [{ path: "/teacher", label: "home" }, { path, label: "builder-class" }] : [
      { path: "/teacher", label: "home" }, { path, label: "builder-class" },
      { path, label: "builder-class-picked", steps: [{ clickText: "B7 Gold" }, { wait: 300 }] },
      { path, label: "builder-scope", steps: [{ clickText: "B7 Gold" }, { clickText: "Next step" }] },
    ],
    tables: { ...base.tables, platform_settings: off ? [] : [flag("q_insignia_subject_cards_v02", true), flag("q_insignia_concept_photos", true)] },
  };
}
