import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/markets", () => ({ getMyAccount: () => Promise.resolve({ school_name: null }) }));
vi.mock("@/lib/api/schools", async (orig) => ({ ...(await orig<typeof import("@/lib/api/schools")>()), listSchoolRegions: () => Promise.reject(new Error("off")), listSchoolDistricts: () => Promise.resolve([]), searchSchools: () => Promise.resolve([]) }));

import SchoolSetupCard from "./SchoolSetupCard";

describe("SchoolSetupCard", () => {
  it("shows nothing until the school directory answers (it stays hidden while the feature is off)", () => {
    expect(renderToStaticMarkup(<SchoolSetupCard />)).toBe("");
  });
});
