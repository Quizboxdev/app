import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { headingsOf, parseBlocks, RenderText } from "./render";

const html = (s: string) => renderToStaticMarkup(<RenderText source={s} />);

describe("policy text", () => {
  it("turns simple formatting into headings, paragraphs, lists, bold and links", () => {
    const out = html("# Terms\n\nFirst line\nsecond line of the same paragraph.\n\n## Your rights\n\n- one\n- **two**\n\n1. step a\n2. step b\n\nSee [the refund policy](/refunds) or [Paystack](https://paystack.com).");
    expect(out).toContain("<h2 id=\"terms\">Terms</h2>");
    expect(out).toContain("<p>First line second line of the same paragraph.</p>");
    expect(out).toContain("<h3 id=\"your-rights\">Your rights</h3>");
    expect(out).toContain("<ul><li>one</li><li><strong>two</strong></li></ul>");
    expect(out).toContain("<ol><li>step a</li><li>step b</li></ol>");
    expect(out).toContain('<a class="qbp-link" href="/refunds">the refund policy</a>');
    expect(out).toContain('href="https://paystack.com" target="_blank" rel="noopener noreferrer"');
  });
  it("never lets typed text run as code: HTML is escaped and unsafe links are shown as plain words", () => {
    const out = html("<script>alert(1)</script> and [click](javascript:alert(1)) and [data](data:text/html,x) and [x](//evil.example) and <img src=x onerror=alert(1)>");
    expect(out).not.toContain("<script"); expect(out).not.toContain("<img"); expect(out).not.toMatch(/href="javascript/i); expect(out).not.toMatch(/href="data:/i); expect(out).not.toContain('href="//evil');
    expect(out).toContain("&lt;script&gt;"); expect(out).toContain("click");
  });
  it("lists the second-level headings for a table of contents", () => {
    expect(headingsOf("# T\n\n## First part\n\ntext\n\n## **Second** part\n\n### minor")).toEqual([{ text: "First part", id: "first-part" }, { text: "Second part", id: "second-part" }]);
  });
  it("copes with Windows line endings, empty input and stray spaces", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks("  \r\n\r\n  hello  \r\n")).toEqual([{ kind: "p", text: "hello" }]);
  });
  it("points help:slug links at another guide, in the public or the in-app place, and refuses a bad one", () => {
    const text = "See [how to join](help:join-a-class) and [bad](help:../../x) and [worse](help:Join_A_Class).";
    expect(renderToStaticMarkup(<RenderText source={text} />)).toContain('href="/help/join-a-class"');
    const app = renderToStaticMarkup(<RenderText source={text} helpBase="/guides" linkClass="qb-link" />);
    expect(app).toContain('<a class="qb-link" href="/guides/join-a-class">how to join</a>');
    expect(app).not.toContain("..");
    expect(app).not.toMatch(/href="[^"]*Join_A_Class/);
  });
});
