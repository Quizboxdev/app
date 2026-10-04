import { describe, expect, it } from "vitest";
import { toPublicMarkets } from "./signup-markets";

describe("toPublicMarkets", () => {
  it("keeps only display labels for available markets", () => {
    const result = toPublicMarkets([
      {
        country_code: "GH", country: "Ghana", market_id: "00000000-0000-0000-0000-000000000001", market: "Ghana JHS", available: true, locale: "en-GH",
        education_levels: [{ code: "JHS", label: "Junior High School" }],
        grades: [{ code: "B7", label: "Basic 7", level: "JHS" }],
        subjects: [{ code: "MATH", label: "Mathematics" }, { code: "SCI", label: "Science" }, { code: "MATH2", label: "Mathematics" }],
      },
      { country_code: "NG", country: "Nigeria", market_id: null, market: null, available: false, locale: "en-NG", education_levels: [], grades: [], subjects: [] },
    ]);
    expect(result).toEqual({
      available: [{ country: "Ghana", market: "Ghana JHS", educationLevels: ["Junior High School"], subjects: ["Mathematics", "Science"] }],
      upcomingCountries: ["Nigeria"],
    });
    expect(JSON.stringify(result)).not.toContain("0000");
    expect(JSON.stringify(result)).not.toContain("MATH");
  });

  it("tolerates malformed payloads", () => {
    expect(toPublicMarkets(null)).toEqual({ available: [], upcomingCountries: [] });
    expect(toPublicMarkets([{ available: true }, { country: "  ", available: true }, "x"])).toEqual({ available: [], upcomingCountries: [] });
    expect(toPublicMarkets([{ country: "Ghana", available: true, subjects: [{ label: 5 }, { label: "" }] }]).available[0]).toEqual({ country: "Ghana", market: "Ghana", educationLevels: [], subjects: [] });
  });
});
