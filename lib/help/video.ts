// Help videos: how a pasted YouTube link becomes a video id, and the few addresses built from it. Pure functions, no network.
// Videos are played in the privacy-enhanced YouTube player (youtube-nocookie.com) only after the person presses play, and "Watch on YouTube" goes through our own /go/video/<id> address,
// which counts the click and then sends the person to the video on YouTube.
export type HelpVideo = { id: string; title: string; summary: string; youtube_id: string; duration_seconds: number | null };
export type HelpVideoListed = HelpVideo & { guide: { slug: string; title: string } | null };

const ID = /^[A-Za-z0-9_-]{11}$/;
export const isYouTubeId = (s: string) => ID.test(s);
export const isVideoUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Accepts a bare 11-character id or any usual YouTube address: watch, youtu.be, embed, shorts, live, mobile and music. Anything else gives null.
export function parseYouTubeId(input: string): string | null {
  const raw = String(input ?? "").trim();
  if (isYouTubeId(raw)) return raw;
  let u: URL;
  try { u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "watch") id = u.searchParams.get("v");
    else if (["embed", "shorts", "live", "v"].includes(parts[0])) id = parts[1] ?? null;
  }
  return id && isYouTubeId(id) ? id : null;
}

export const thumbnailUrl = (youtubeId: string) => `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
export const embedUrl = (youtubeId: string) => `https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&modestbranding=1&playsinline=1&autoplay=1`;
export const youtubeWatchUrl = (youtubeId: string) => `https://www.youtube.com/watch?v=${youtubeId}`;
export const watchOnYouTubePath = (videoUuid: string) => `/go/video/${videoUuid}`;

// "2:05", "12:00", "1:02:03"; nothing when the length is not known.
export function formatDuration(seconds: number | null | undefined): string {
  if (!Number.isFinite(seconds) || (seconds as number) <= 0) return "";
  const s = Math.round(seconds as number), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
// "2:05" or "125" typed by an admin becomes seconds; empty gives null; anything else gives undefined (not valid).
export function parseDuration(input: string): number | null | undefined {
  const t = String(input ?? "").trim();
  if (t === "") return null;
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(t);
  let s: number;
  if (m) s = (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
  else if (/^\d{1,5}$/.test(t)) s = Number(t);
  else return undefined;
  return s >= 1 && s <= 7200 ? s : undefined;
}
