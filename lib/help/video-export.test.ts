import { describe, expect, it } from "vitest";
import { VIDEO_EXPORT_COLUMNS, videosCsv, videosCsvName } from "./video-export";
import type { AdminVideo } from "@/lib/api/help-videos";

// Explicit test content, never used by application routes.
const row = (o: Partial<AdminVideo> = {}): AdminVideo => ({ id: "00000000-0000-4000-8000-000000000001", title: "Create a class", summary: "", youtube_id: "dQw4w9WgXcQ", audiences: ["teacher"], duration_seconds: 125, sort_order: 10, state: "published", plays: 3, outbound: 1, updated_at: "2026-11-23T10:00:00Z", slugs: ["create-a-class", "join-a-class"], ...o });
describe("Help video export", () => {
  it("writes a header and one line per video, with the guides, the counts and the share of clicks", () => {
    const lines = videosCsv([row()], (s) => (s === "create-a-class" ? "Create a class" : "Join a class")).replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe(VIDEO_EXPORT_COLUMNS.join(","));
    expect(lines[1]).toBe('Create a class,published,dQw4w9WgXcQ,https://www.youtube.com/watch?v=dQw4w9WgXcQ,2:05,125,teacher,Create a class | Join a class,create-a-class|join-a-class,10,3,1,25,2026-11-23');
  });
  it("starts with a byte-order mark and ends each line with CRLF", () => {
    const csv = videosCsv([row()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff); expect(csv.endsWith("\r\n")).toBe(true);
  });
  it("quotes commas and quotes, and stops a title from running as a formula", () => {
    const csv = videosCsv([row({ title: 'Say "hello", then go', summary: "" }), row({ title: "=HYPERLINK(1)" }), row({ title: "-5 minutes" })]);
    expect(csv).toContain('"Say ""hello"", then go"'); expect(csv).toContain("'=HYPERLINK(1)"); expect(csv).toContain("'-5 minutes");
  });
  it("leaves the length and the share empty when they are not known, and lists only the header when there are no videos", () => {
    expect(videosCsv([row({ duration_seconds: null, plays: 0, outbound: 0 })]).split("\r\n")[1]).toContain(",,,teacher,");
    expect(videosCsv([]).replace(/^﻿/, "").trim()).toBe(VIDEO_EXPORT_COLUMNS.join(","));
  });
  it("names the file with the date", () => { expect(videosCsvName(new Date("2026-11-23T09:00:00Z"))).toBe("quizbox_help_videos_2026-11-23.csv"); });
});
