import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import PublicPost from "@/components/posts/PublicPost";
import type { PostPublic } from "./presentation";

const post: PostPublic = {
  slug: "big-news", title: "Big news for learners", summary: "Practice papers are now live for every JHS subject.",
  body: "# Big news for learners\n\nFirst paragraph about the news.\n\nSecond paragraph with more detail.\n\nThird paragraph to finish.",
  flyer_path: "123e4567-e89b-42d3-a456-426614174000.png", flyer_alt: "Flyer showing the JHS practice papers", published_at: "2026-11-24T08:00:00Z", updated_at: "2026-11-24T08:00:00Z",
};

describe("the public post page", () => {
  beforeAll(() => { vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co"); });
  const render = () => renderToStaticMarkup(<PublicPost post={post} />);
  it("shows the title once, the summary, the date and the flyer with its description", () => {
    const html = render();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Practice papers are now live for every JHS subject.");
    expect(html).toContain("24 November 2026");
    expect(html).toContain('alt="Flyer showing the JHS practice papers"');
  });
  it("puts a subscribe link inside the article and a Subscribe now button at the foot, both to sign-up", () => {
    const html = render();
    const links = html.match(/href="\/login\?mode=register&amp;utm_source=post&amp;utm_campaign=big-news"/g) ?? [];
    expect(links.length).toBe(2);
    expect(html).toContain("Subscribe now");
    expect(html.indexOf("Subscribe free and start practising")).toBeLessThan(html.indexOf("Subscribe now"));
  });
  it("leaves out the flyer when there is none", () => {
    expect(renderToStaticMarkup(<PublicPost post={{ ...post, flyer_path: null }} />)).not.toContain("<figure");
  });
});
