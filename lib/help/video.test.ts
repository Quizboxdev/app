import { describe, expect, it } from "vitest";
import { embedUrl, formatDuration, isVideoUuid, parseDuration, parseYouTubeId, thumbnailUrl, watchOnYouTubePath, youtubeWatchUrl } from "./video";

describe("parseYouTubeId", () => {
  const ID = "dQw4w9WgXcQ";
  it("accepts a bare id and the usual YouTube addresses", () => {
    for (const s of [ID, `  ${ID}  `, `https://www.youtube.com/watch?v=${ID}`, `https://www.youtube.com/watch?v=${ID}&t=42s&list=PL1`, `youtube.com/watch?v=${ID}`, `https://m.youtube.com/watch?v=${ID}`,
      `https://music.youtube.com/watch?v=${ID}`, `https://youtu.be/${ID}`, `https://youtu.be/${ID}?si=abc`, `https://www.youtube.com/embed/${ID}`, `https://www.youtube-nocookie.com/embed/${ID}?rel=0`,
      `https://www.youtube.com/shorts/${ID}`, `https://www.youtube.com/live/${ID}?feature=share`, `http://youtube.com/v/${ID}`]) expect(parseYouTubeId(s), s).toBe(ID);
  });
  it("refuses anything that is not a single YouTube video", () => {
    for (const s of ["", "   ", "not a link", "https://example.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/", "https://www.youtube.com/watch", "https://www.youtube.com/playlist?list=PL12345678901",
      "https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx", "https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ", "https://evilyoutube.com/watch?v=dQw4w9WgXcQ", "javascript:alert(1)",
      "https://www.youtube.com/watch?v=short", "https://www.youtube.com/watch?v=dQw4w9WgXcQ_extra", "dQw4w9WgXc", "dQw4w9WgXcQQ"]) expect(parseYouTubeId(s), s).toBeNull();
  });
});

describe("addresses", () => {
  it("builds the privacy-enhanced player address, the thumbnail, the YouTube page and our own redirect address", () => {
    expect(embedUrl("dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1&playsinline=1&autoplay=1");
    expect(thumbnailUrl("dQw4w9WgXcQ")).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(youtubeWatchUrl("dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(watchOnYouTubePath("00000000-0000-4000-8000-000000000001")).toBe("/go/video/00000000-0000-4000-8000-000000000001");
  });
  it("recognises a video uuid and nothing else", () => {
    expect(isVideoUuid("00000000-0000-4000-8000-000000000001")).toBe(true);
    for (const s of ["", "1", "../etc/passwd", "00000000-0000-4000-8000-00000000000g", "dQw4w9WgXcQ"]) expect(isVideoUuid(s), s).toBe(false);
  });
});

describe("durations", () => {
  it("shows minutes and seconds, with hours only when needed, and nothing when unknown", () => {
    expect(formatDuration(125)).toBe("2:05"); expect(formatDuration(59)).toBe("0:59"); expect(formatDuration(3723)).toBe("1:02:03");
    for (const v of [null, undefined, 0, -3, NaN]) expect(formatDuration(v as number | null)).toBe("");
  });
  it("reads m:ss, h:mm:ss or plain seconds; empty is unknown; anything else is not valid", () => {
    expect(parseDuration("2:05")).toBe(125); expect(parseDuration("1:02:03")).toBe(3723); expect(parseDuration("90")).toBe(90); expect(parseDuration("  ")).toBeNull();
    for (const s of ["abc", "1:2", "0", "0:00", "2:61x", "99999", "3:00:01"]) expect(parseDuration(s), s).toBeUndefined();
  });
});
