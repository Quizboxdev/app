import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import GuideCatalogue, { GUIDE_TABS } from "./GuideCatalogue";
import type { HelpMeta } from "@/lib/help/categories";

const guide: HelpMeta = { slug: "qa-guide", title: "QA guide", summary: "Synthetic test summary", category: "account", audiences: ["student"] };
const props = { guides: [guide], audience: "student", query: "", failed: false, onAudience: () => undefined, onQuery: () => undefined, onRetry: () => undefined };
describe("Canvas 11 authenticated guide catalogue", () => {
  it("uses real guide fields and the existing in-app article route", () => {
    const html = renderToStaticMarkup(<GuideCatalogue {...props} />);
    expect(html).toContain('href="/guides/qa-guide"');
    expect(html).toContain("Synthetic test summary");
    expect(html).not.toContain("min read");
    expect(html).not.toContain("5 steps");
    expect(html).toContain('aria-selected="true"');
    expect(GUIDE_TABS.map(t => t.audience)).toEqual([null, "student", "teacher", "school", "sponsor"]);
  });
  it("keeps loading, empty and error states distinct", () => {
    expect(renderToStaticMarkup(<GuideCatalogue {...props} guides={null} />)).toContain("Loading guides");
    const empty = renderToStaticMarkup(<GuideCatalogue {...props} guides={[]} />);
    expect(empty).toContain("No guides available for this role");
    expect(empty).not.toContain("QA guide");
    const error = renderToStaticMarkup(<GuideCatalogue {...props} guides={null} failed />);
    expect(error).toContain("We could not load these guides");
    expect(error).toContain("Try again");
    expect(error).not.toContain("No guides available");
  });
  it("preserves search recovery without inventing articles", () => {
    const html = renderToStaticMarkup(<GuideCatalogue {...props} guides={[]} query="missing" />);
    expect(html).toContain("No guides match your search");
    expect(html).toContain("Clear search");
    expect(html).toContain('href="/support/new"');
  });
  it("does not turn unsupported audience identifiers into new role labels", () => {
    const html = renderToStaticMarkup(<GuideCatalogue {...props} guides={[{ ...guide, audiences: ["not-a-supported-audience"] }]} />);
    expect(html).toContain("QA guide");
    expect(html).not.toContain("not-a-supported-audience");
  });
});
