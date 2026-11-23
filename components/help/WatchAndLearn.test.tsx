import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WatchAndLearn, { WatchRow } from "./WatchAndLearn";
import type { HelpVideoListed } from "@/lib/help/video";

// Explicit test content, never used by application routes.
const v = (n: number, guide: HelpVideoListed["guide"]): HelpVideoListed => ({ id: `00000000-0000-4000-8000-00000000000${n}`, title: `Video ${n}`, summary: "", youtube_id: "dQw4w9WgXcQ", duration_seconds: 125, guide });
describe("Watch and learn row", () => {
  it("shows nothing before any video is loaded, so the Help home looks the same as before", () => {
    expect(renderToStaticMarkup(<WatchAndLearn base="/help" audience={null} />)).toBe("");
    expect(renderToStaticMarkup(<WatchRow videos={[]} base="/guides" />)).toBe("");
  });
  it("opens the guide a video belongs to, on the website and in the app", () => {
    const guide = { slug: "create-a-class", title: "Create a class" };
    expect(renderToStaticMarkup(<WatchRow videos={[v(1, guide)]} base="/help" />)).toContain('href="/help/create-a-class"');
    const app = renderToStaticMarkup(<WatchRow videos={[v(1, guide)]} base="/guides" />);
    expect(app).toContain('href="/guides/create-a-class"');
    expect(app).toContain("Watch and learn"); expect(app).toContain("In: Create a class"); expect(app).toContain("2:05");
    expect(app).toContain('src="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"');
    expect(app).not.toContain("<iframe"); expect(app).not.toContain("youtube-nocookie");
  });
  it("sends a video with no published guide through the counting address, never straight to YouTube", () => {
    const html = renderToStaticMarkup(<WatchRow videos={[v(2, null)]} base="/help" />);
    expect(html).toContain('href="/go/video/00000000-0000-4000-8000-000000000002"');
    expect(html).toContain('rel="noopener nofollow"'); expect(html).not.toContain('href="https://www.youtube.com');
  });
  it("shows at most eight videos", () => {
    const html = renderToStaticMarkup(<WatchRow videos={Array.from({ length: 12 }, (_, i) => v(i, null))} base="/help" />);
    expect((html.match(/<li/g) ?? []).length).toBe(8);
  });
});
