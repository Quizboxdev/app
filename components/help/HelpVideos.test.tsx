import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import HelpVideos, { VideoCard } from "./HelpVideos";
import type { HelpVideo } from "@/lib/help/video";

// Explicit test content, never used by application routes.
const video: HelpVideo = { id: "00000000-0000-4000-8000-000000000001", title: "Create a class in two minutes", summary: "Set up a class and share its code.", youtube_id: "dQw4w9WgXcQ", duration_seconds: 125 };
describe("Help video card", () => {
  it("shows a play button over the thumbnail, the length, and no YouTube player until play is pressed", () => {
    const html = renderToStaticMarkup(<VideoCard video={video} inApp />);
    expect(html).toContain('aria-label="Play video: Create a class in two minutes (2:05)"');
    expect(html).toContain('src="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"');
    expect(html).toContain("2:05");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("youtube-nocookie");
  });
  it("sends 'Watch on YouTube' through our own counting address, in a new tab, never straight to YouTube", () => {
    const html = renderToStaticMarkup(<VideoCard video={video} inApp={false} />);
    expect(html).toContain('href="/go/video/00000000-0000-4000-8000-000000000001"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener nofollow"');
    expect(html).toContain("Watch on YouTube");
    expect(html).not.toContain('href="https://www.youtube.com');
    expect(html).toContain("qbp-card"); expect(html).not.toContain("qb-card");
  });
  it("leaves out the length and the summary when they are not known", () => {
    const html = renderToStaticMarkup(<VideoCard video={{ ...video, duration_seconds: null, summary: "" }} inApp />);
    expect(html).toContain('aria-label="Play video: Create a class in two minutes"');
    expect(html).not.toContain("0:00");
  });
  it("shows nothing at all before any video is loaded for a guide", () => {
    expect(renderToStaticMarkup(<HelpVideos slug="create-a-class" inApp />)).toBe("");
  });
});
