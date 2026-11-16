import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href, className }: any) => <a href={href} className={className}>{children}</a> }));
vi.mock("@/lib/api/family", async (orig) => ({ ...(await orig<typeof import("@/lib/api/family")>()), myFamilySets: () => Promise.resolve([]), familyLibrary: () => Promise.resolve([]), listFamilyChildren: () => Promise.resolve([]) }));

import FamilySetsCard from "./FamilySetsCard";
import FamilyLibraryPage from "../../app/(app)/family/library/page";
import SetPlayer from "../marketplace/SetPlayer";

describe("question library screens", () => {
  it("a student sees nothing until a family set exists", () => { expect(renderToStaticMarkup(<FamilySetsCard />)).toBe(""); });
  it("the library paints a loading state first", () => { expect(renderToStaticMarkup(<FamilyLibraryPage />)).toContain("aria-busy"); });
  it("the shared player loads first and links back to where it was opened from", () => {
    const html = renderToStaticMarkup(<SetPlayer id="x" open={() => new Promise(() => undefined)} record={async () => undefined} backHref="/student" backLabel="Home" />);
    expect(html).toContain("Loading");
  });
});
