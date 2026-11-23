"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { embedUrl, formatDuration, thumbnailUrl, watchOnYouTubePath, type HelpVideo } from "@/lib/help/video";

// "Watch how it works": the videos linked to one guide. Nothing is shown when the guide has none. A video loads from YouTube only after the person presses play (then the privacy-enhanced
// player is used), and "Watch on YouTube" goes through /go/video/<id>, which counts the click and sends the person to our channel. A play is counted once per device per hour; no personal data is sent.
const trackPlay = (id: string) => { try { void fetch("/api/help/video-track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, event: "play" }), keepalive: true }); } catch { /* a missed count is harmless */ } };

export function VideoCard({ video, inApp }: { video: HelpVideo; inApp: boolean }) {
  const [playing, setPlaying] = useState(false);
  const length = formatDuration(video.duration_seconds), link = inApp ? "qb-link" : "qbp-link";
  return (
    <div className={inApp ? "qb-card" : "qbp-card"} style={{ display: "grid", gap: 10 }} data-testid="help-video">
      <div style={{ position: "relative", aspectRatio: "16 / 9", background: "#0b1220", borderRadius: 10, overflow: "hidden" }}>
        {playing ? (
          <iframe src={embedUrl(video.youtube_id)} title={video.title} loading="lazy" referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
        ) : (
          <button type="button" aria-label={`Play video: ${video.title}${length ? ` (${length})` : ""}`} onClick={() => { setPlaying(true); trackPlay(video.id); }}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", padding: 0, border: 0, cursor: "pointer", background: "transparent" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbnailUrl(video.youtube_id)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            <span aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: 64, height: 64, borderRadius: "50%", background: "rgba(0,0,0,.72)", color: "#fff", display: "grid", placeItems: "center", fontSize: 28, paddingLeft: 4 }}>▶</span>
            {length && <span aria-hidden="true" style={{ position: "absolute", right: 8, bottom: 8, background: "rgba(0,0,0,.78)", color: "#fff", fontSize: 12, padding: "2px 6px", borderRadius: 4 }}>{length}</span>}
          </button>
        )}
      </div>
      <div>
        <strong>{video.title}</strong>
        {video.summary && <p className={inApp ? "qb-muted qb-small" : undefined} style={{ margin: "4px 0 0" }}>{video.summary}</p>}
        <p style={{ margin: "6px 0 0" }}><a className={link} href={watchOnYouTubePath(video.id)} target="_blank" rel="noopener nofollow">Watch on YouTube</a></p>
      </div>
    </div>
  );
}

export default function HelpVideos({ slug, inApp }: { slug: string; inApp: boolean }) {
  const [videos, setVideos] = useState<HelpVideo[]>([]);
  useEffect(() => {
    let alive = true;
    Promise.resolve(getSupabaseBrowserClient().rpc("qb_help_videos_for", { p_slug: slug })).then(({ data }) => { if (alive && Array.isArray(data)) setVideos(data as HelpVideo[]); }).catch(() => { /* no videos shown */ });
    return () => { alive = false; };
  }, [slug]);
  if (videos.length === 0) return null;
  return (
    <section aria-labelledby="help-videos" style={{ maxWidth: 760, margin: "16px 0", display: "grid", gap: 12 }} data-qb-section="help-videos">
      <h2 id="help-videos" style={{ fontSize: 18, margin: 0 }}>{videos.length === 1 ? "Watch how it works" : "Watch how it works: videos"}</h2>
      {videos.map((v) => <VideoCard key={v.id} video={v} inApp={inApp} />)}
    </section>
  );
}
