import { describe, expect, it } from "vitest";
import { parseChildInput } from "./child-input";

const ok = { firstName: "Ama", lastName: "Mensah", displayName: "", age: 11, gradeCode: "B5", school: "XYZ Academy", consentConfirmed: true };

describe("parseChildInput", () => {
  it("accepts a normal child and tidies spaces", () => {
    const r = parseChildInput({ ...ok, firstName: "  Ama   Esi ", age: "11" });
    expect(r).toEqual({ ok: true, value: { firstName: "Ama Esi", lastName: "Mensah", displayName: "", age: 11, gradeCode: "B5", school: "XYZ Academy" } });
  });
  it("needs the parent's confirmation", () => { expect(parseChildInput({ ...ok, consentConfirmed: false }).ok).toBe(false); expect(parseChildInput({ ...ok, consentConfirmed: "true" }).ok).toBe(false); });
  it("refuses bad names, ages, classes and symbols", () => {
    for (const bad of [{ firstName: "A" }, { firstName: "Ama1" }, { lastName: "<b>" }, { displayName: "a@b" }, { age: 2 }, { age: 31 }, { age: 11.5 }, { age: "x" }, { gradeCode: "" }, { gradeCode: "B 5!" }, { school: "<script>" }])
      expect(parseChildInput({ ...ok, ...bad }).ok, JSON.stringify(bad)).toBe(false);
  });
});
