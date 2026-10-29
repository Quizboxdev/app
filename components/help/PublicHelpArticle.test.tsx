import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PublicHelpArticle from "./PublicHelpArticle";
import type { HelpDetail } from "@/lib/help/categories";

const detail: HelpDetail = { article: { slug: "qa-article", title: "QA article", summary: "Synthetic test summary", category: "account", audiences: ["everyone"], updated_at: "", body: "# QA article\n\n## First section\n\nKeep **original formatting** and [a guide](help:qa-related).\n\n## Second section\n\n[Unsafe](javascript:alert) is plain text." }, related: [{ slug: "qa-related", title: "QA related article", summary: "Test related summary" }] };
describe("Canvas 11 public Help article", () => {
  it("derives table of contents and links from the original article body", () => {
    const html = renderToStaticMarkup(<PublicHelpArticle detail={detail} />);
    expect(html).toContain('href="#first-section"');
    expect(html).toContain('id="first-section"');
    expect(html).toContain('<strong>original formatting</strong>');
    expect(html).toContain('href="/help/qa-related"');
    expect(html).toContain("QA related article");
    expect(html).not.toContain('href="javascript:');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Updated [date]");
    expect(html).not.toContain("min read");
    expect(html).toContain("Was this guide helpful?");
  });
  it("does not manufacture sections or related content", () => {
    const html = renderToStaticMarkup(<PublicHelpArticle detail={{ ...detail, article: { ...detail.article, body: "A real paragraph without headings." }, related: [] }} />);
    expect(html).not.toContain("On this page");
    expect(html).not.toContain("Related articles");
    expect(html).toContain("A real paragraph without headings.");
  });
});
