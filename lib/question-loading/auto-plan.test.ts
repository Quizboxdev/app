import { describe, expect, it } from "vitest";
import { parsePlan } from "./auto-plan";

const CSV = "﻿seq,session,environment,grade,subject,kind,rows,file,loaded,batch_id,approved,note\r\n" +
  "2,1,Preview,B4,Mathematics,READY,1000,Preview\\Primary\\B4\\Mathematics\\B4_Mathematics.delta-02.csv,,,,\r\n" +
  "1,1,Preview,B4,\"Our World, Our People\",READY_FIXED,249,Preview\\Primary\\B4\\OWOP\\B4_OWOP.fixed-01.csv,,,,\r\n\r\n";

describe("load plan", () => {
  it("reads the plan in load order, with Windows paths turned into forward slashes and quoted commas kept", () => {
    const p = parsePlan(CSV);
    expect(p.map((x) => x.seq)).toEqual([1, 2]);
    expect(p[0]).toMatchObject({ session: 1, environment: "Preview", subject: "Our World, Our People", kind: "READY_FIXED", rows: 249, file: "Preview/Primary/B4/OWOP/B4_OWOP.fixed-01.csv" });
  });
  it("refuses a plan without the columns it needs or with a broken number", () => {
    expect(() => parsePlan("a,b\n1,2")).toThrow(/no "seq" column/);
    expect(() => parsePlan("seq,session,file,rows\nx,1,f.csv,10")).toThrow(/non-numeric/);
  });
  it("returns nothing for an empty file", () => expect(parsePlan("")).toEqual([]));
});
