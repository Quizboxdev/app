import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/admin/ExportLink", () => ({ default: () => <span>export</span> }));

import ContentQualityPage from "./page";

describe("content quality screen", () => {
  const html = renderToStaticMarkup(<ContentQualityPage />);
  it("shows the heading and the first-paint state", () => {
    expect(html).toContain("Content quality");
    expect(html).toContain("dx-page");
  });
  it("has no large unclassed buttons", () => {
    expect([...html.matchAll(/<button(?![^>]*class=)[^>]*>/g)]).toHaveLength(0);
  });
});
