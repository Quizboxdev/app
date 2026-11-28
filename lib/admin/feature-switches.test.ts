import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AREAS, FEATURE_SWITCHES, buildSwitchList, checkChange, nameFromKey, needsExtraCare } from "./feature-switches";
import { FEATURE_FLAGS } from "@/lib/core/config";

const dir = new URL("../../supabase/migrations/", import.meta.url);
// Every switch a migration creates: a quoted 'flags.<name>' followed by its value in an insert or select.
const seeded = new Set(readdirSync(dir).filter((f) => f.endsWith(".sql")).flatMap((f) =>
  [...readFileSync(new URL(f, dir), "utf8").matchAll(/'(flags\.[a-z0-9_]+)'\s*,\s*'(?:true|false)'/g)].map((m) => m[1])));

describe("feature switch list", () => {
  it("covers every switch the migrations create and every switch the screens read", () => {
    const known = new Set(FEATURE_SWITCHES.map((s) => s.key));
    expect(seeded.size).toBeGreaterThan(15);
    expect([...seeded].filter((k) => !known.has(k))).toEqual([]);
    expect(FEATURE_FLAGS.map((f) => `flags.${f}`).filter((k) => !known.has(k))).toEqual([]);
  });
  it("has unique, valid keys, known areas, and requirements that exist", () => {
    const keys = FEATURE_SWITCHES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of FEATURE_SWITCHES) {
      expect(s.key).toMatch(/^flags\.[a-z0-9_]+$/);
      expect(AREAS).toContain(s.area);
      expect(s.on.length).toBeGreaterThan(10);
      expect(s.off.length).toBeGreaterThan(10);
      for (const r of s.requires ?? []) expect(keys).toContain(r);
    }
  });
  it("marks money and safety switches for an extra confirmation", () => {
    expect(needsExtraCare(FEATURE_SWITCHES.find((s) => s.key === "flags.buy_coins_enabled")!)).toBe(true);
    expect(needsExtraCare(FEATURE_SWITCHES.find((s) => s.key === "flags.sponsor_consent_required")!)).toBe(true);
    expect(needsExtraCare(FEATURE_SWITCHES.find((s) => s.key === "flags.repeat_assignments")!)).toBe(false);
  });
});

describe("building the screen list from the database", () => {
  const rows = [
    { key: "flags.mock_exams", value: false, updated_at: "2026-11-20T10:00:00Z" },
    { key: "flags.mock_exam_links", value: false },
    { key: "flags.family_workspace", value: true },
    { key: "flags.brand_new_thing", value: true, description: "Something installed after this list was written" },
    { key: "payments.providers", value: [] },
  ];
  const list = buildSwitchList(rows);
  const get = (k: string) => list.find((s) => s.key === k)!;

  it("reads on, off and not installed", () => {
    expect(get("flags.family_workspace")).toMatchObject({ installed: true, value: true, canChange: true });
    expect(get("flags.mock_exams")).toMatchObject({ installed: true, value: false, updatedAt: "2026-11-20T10:00:00Z" });
    expect(get("flags.interschool")).toMatchObject({ installed: false, value: null, canChange: false });
  });
  it("lets a screen-only switch be set before it has a row", () => {
    expect(get("flags.design_v02_help")).toMatchObject({ installed: false, canChange: true });
  });
  it("shows a switch it does not know under Other switches, with the database description", () => {
    expect(get("flags.brand_new_thing")).toMatchObject({ area: "Other switches", name: "Brand new thing", value: true, on: "Something installed after this list was written" });
    expect(list.some((s) => s.key === "payments.providers")).toBe(false);
  });
  it("blocks turning on a switch whose requirement is off, and a switch not installed", () => {
    expect(checkChange(get("flags.mock_exam_links"), true, list).blocked).toEqual(['Turn on "Mock exams" first.']);
    expect(checkChange(get("flags.interschool"), true, list).blocked[0]).toMatch(/not installed/);
    expect(checkChange(get("flags.mock_exams"), true, list).blocked).toEqual([]);
  });
  it("names what stops working when a required switch is turned off", () => {
    const on = buildSwitchList([{ key: "flags.mock_exams", value: true }, { key: "flags.mock_exam_links", value: true }]);
    expect(checkChange(on.find((s) => s.key === "flags.mock_exams")!, false, on)).toEqual({ blocked: [], affects: ["Mock exam links"] });
  });
  it("turns a key into a readable name", () => {
    expect(nameFromKey("flags.partner_v2_gate")).toBe("Partner v2 gate");
  });
});
