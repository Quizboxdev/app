import { formatDuration, youtubeWatchUrl } from "./video";
import type { AdminVideo } from "@/lib/api/help-videos";

// The Help video library as a spreadsheet file (CSV): one row per video with what it is shown on and how often it was played or sent to YouTube. Pure functions, no network.
// A text cell that starts with = + - @ is quoted with a leading apostrophe so Excel never reads it as a formula; the file starts with a byte-order mark so Excel shows accents correctly.
const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const VIDEO_EXPORT_COLUMNS = ["title", "status", "youtube_id", "youtube_link", "length", "length_seconds", "audiences", "shown_on_guides", "guide_slugs", "order", "plays_on_quizbox", "clicks_to_youtube", "clicks_share_percent", "last_changed"] as const;

export function videosCsv(rows: AdminVideo[], guideTitle: (slug: string) => string = (s) => s): string {
  const lines = [VIDEO_EXPORT_COLUMNS.join(",")];
  for (const r of rows) {
    const total = r.plays + r.outbound;
    lines.push([r.title, r.state, r.youtube_id, youtubeWatchUrl(r.youtube_id), formatDuration(r.duration_seconds), r.duration_seconds, r.audiences.join("|"), r.slugs.map(guideTitle).join(" | "), r.slugs.join("|"),
      r.sort_order, r.plays, r.outbound, total > 0 ? Math.round((r.outbound / total) * 100) : "", r.updated_at ? String(r.updated_at).slice(0, 10) : ""].map(cell).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
export const videosCsvName = (d: Date = new Date()) => `quizbox_help_videos_${d.toISOString().slice(0, 10)}.csv`;
