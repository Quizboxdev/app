import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href, className }: any) => <a href={href} className={className}>{children}</a> }));
vi.mock("@/lib/api/family", async (orig) => ({ ...(await orig<typeof import("@/lib/api/family")>()), myFamilyChallenges: () => Promise.resolve([]), familyChallenges: () => Promise.resolve([]), listFamilyChildren: () => Promise.resolve([]) }));

import FamilyChallengesCard from "./FamilyChallengesCard";
import FamilyChallengesPage from "../../app/(app)/family/challenges/page";

describe("family challenge screens", () => {
  it("a student sees nothing until a family challenge exists", () => { expect(renderToStaticMarkup(<FamilyChallengesCard />)).toBe(""); });
  it("the parent page paints a loading state first", () => { expect(renderToStaticMarkup(<FamilyChallengesPage />)).toContain("aria-busy"); });
});
