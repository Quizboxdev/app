import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import HelpCentre from "./HelpCentre";
import type { HelpMeta } from "@/lib/help/categories";

// Explicit test content, never used by application routes.
const article: HelpMeta = { slug: "test-article", title: "Test article", summary: "Test summary", category: "account", audiences: ["everyone"], views: 2 };
describe("Help centre presentation", () => {
  it("shows only real nonempty topics and derives popular articles from views", () => {
    const html = renderToStaticMarkup(<HelpCentre guides={[article]} />);
    expect(html).toContain("Your account and support");
    expect(html).toContain("Articles: 1");
    expect(html).toContain('href="/help/test-article"');
    expect(html).toContain("Popular articles");
    expect(html).not.toContain("Getting started");
    expect(html).toContain("[support email]");
    expect(html).toContain('type="search"');
    expect(html).toContain('for="help-centre-search"');
  });
  it("does not invent popularity or articles for an empty library", () => {
    const html = renderToStaticMarkup(<HelpCentre guides={[]} />);
    expect(html).toContain("No articles available yet");
    expect(html).not.toContain("Popular articles");
    expect(html).not.toContain("Articles: 0");
  });
  it("shows recoverable failure separately from empty content", () => {
    const html = renderToStaticMarkup(<HelpCentre guides={[]} unavailable />);
    expect(html).toContain("Help articles could not load");
    expect(html).toContain("Try again");
    expect(html).not.toContain("No articles available yet");
  });
});
