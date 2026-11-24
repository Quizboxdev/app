import { describe, expect, it } from "vitest";
import { flyerUrl, injectSubscribe, postUrl, shareText, slugFromTitle, subscribeHref, subscribeLinkCount } from "./presentation";

const HREF = subscribeHref("big-news");
const SHORT = "First paragraph about the news.\n\nSecond paragraph with more detail.\n\nThird paragraph to finish.";
const LONG = Array.from({ length: 10 }, (_, i) => `Paragraph number ${i + 1} of a long post.`).join("\n\n");

describe("subscribe links in a post", () => {
  it("point to the sign-up screen and carry the post as the source", () => {
    expect(HREF).toBe("/login?mode=register&utm_source=post&utm_campaign=big-news");
  });
  it("are added after the second paragraph when the writer placed none", () => {
    const out = injectSubscribe(SHORT, HREF).split("\n\n");
    expect(out[2]).toContain(HREF);
    expect(out[1]).toBe("Second paragraph with more detail.");
    expect(subscribeLinkCount(SHORT, HREF)).toBe(1);
  });
  it("add a second one in a long post", () => {
    expect(subscribeLinkCount(LONG, HREF)).toBe(2);
  });
  it("use the writer's own link and add nothing else", () => {
    const body = `${SHORT}\n\nTry it: [start now](subscribe) today.`;
    const out = injectSubscribe(body, HREF);
    expect(out).toContain(`[start now](${HREF})`);
    expect(subscribeLinkCount(body, HREF)).toBe(1);
  });
  it("never go inside a list or against a heading", () => {
    const body = "Intro paragraph here.\n\n## Heading\n\n- one\n- two\n\nSecond plain paragraph.\n\nThird plain paragraph.";
    const blocks = injectSubscribe(body, HREF).split("\n\n");
    const at = blocks.findIndex((b) => b.includes(HREF));
    expect(blocks[at - 1]).toBe("Second plain paragraph.");
  });
  it("leave a one-paragraph post alone (the panel at the foot carries the link)", () => {
    expect(injectSubscribe("Just one paragraph.", HREF)).toBe("Just one paragraph.");
  });
});

describe("post addresses", () => {
  it("builds the share link and text", () => {
    expect(postUrl("https://www.quizbox.io/", "big-news")).toBe("https://www.quizbox.io/p/big-news");
    expect(shareText("Title", "Summary", "https://x/p/a")).toBe("Title\nSummary\nhttps://x/p/a");
  });
  it("makes web names from titles", () => {
    expect(slugFromTitle("  Big News: Exams Start Soon! ")).toBe("big-news-exams-start-soon");
  });
  it("resolves a flyer only from a stored name", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000.png";
    expect(flyerUrl(id, "https://abc.supabase.co/")).toBe(`https://abc.supabase.co/storage/v1/object/public/marketing-posts/${id}`);
    expect(flyerUrl("../x.png", "https://abc.supabase.co")).toBeNull();
    expect(flyerUrl(null, "https://abc.supabase.co")).toBeNull();
    expect(flyerUrl(id, undefined)).toBeNull();
  });
});
