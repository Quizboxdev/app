import { describe, expect, it } from "vitest";
import { chunkRows, parseCsv, readSchoolCsv } from "./csv";

describe("school CSV reader", () => {
  it("reads quoted commas, doubled quotes, CRLF and a byte-order mark", () => {
    const t = parseCsv('﻿name,region\r\n"Mary, Queen of ""Peace"" SHS",Ashanti\r\n\r\nPrempeh College,Ashanti\r\n');
    expect(t).toEqual([["name", "region"], ['Mary, Queen of "Peace" SHS', "Ashanti"], ["Prempeh College", "Ashanti"]]);
  });
  it("maps the NaSIA and spec headers, keeps only QuizBox levels and counts what it drops", () => {
    const csv = [
      "school_name,ownership,region,district,town,levels,curriculum,emis_code,source,source_id,needs_review",
      "Adabiya Islamic School,Private,Ahafo,Asunafo North,,KG|Primary|JHS,National Curriculum,E1,NaSIA,5128,",
      "Tiny Tots Nursery,Private,Ahafo,Asunafo North,,KG,National Curriculum,,NaSIA,5129,",
      "No Level School,Private,Volta,Ho,,,,,NaSIA,5130,Y",
      ",Private,Volta,Ho,,JHS,,,NaSIA,5131,",
      "Kumasi Academy,Public,Ashanti,Asokore Mampong,Asokore Mampong,SHS,,,NaSIA,5132,",
    ].join("\n");
    const p = readSchoolCsv(csv);
    expect(p.total).toBe(5);
    expect(p.rows.map((r) => r.name)).toEqual(["Adabiya Islamic School", "Kumasi Academy"]);
    expect(p.rows[0]).toMatchObject({ school_code: "E1", source_ref: "5128", levels: "KG|Primary|JHS" });
    expect(p.dropped).toEqual({ noLevel: 2, missing: 1 });
  });
  it("reports missing required columns instead of guessing", () => {
    expect(readSchoolCsv("school_name,region\nA School,Ashanti").missingColumns).toEqual(["district", "levels"]);
  });
  it("splits rows into chunks", () => {
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
