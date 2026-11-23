"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatDuration, thumbnailUrl, watchOnYouTubePath, type HelpVideoListed } from "@/lib/help/video";
import styles from "./WatchAndLearn.module.css";

// "Watch and learn": a row of the published how-to videos at the top of the Help home. A card opens the guide the video belongs to (the video plays there); a video with no published guide
// opens on YouTube through our own counting address. Nothing is shown until there is at least one video, so the Help home looks the same as before.
const MAX = 8;

export default function WatchAndLearn({ base, audience, className }: { base: "/help" | "/guides"; audience: string | null; className?: string }) {
  const [videos, setVideos] = useState<HelpVideoListed[]>([]);
  useEffect(() => {
    let alive = true;
    Promise.resolve(getSupabaseBrowserClient().rpc("qb_help_videos_list", { p_audience: audience })).then(({ data }) => { if (alive && Array.isArray(data)) setVideos(data as HelpVideoListed[]); }).catch(() => { /* no row shown */ });
    return () => { alive = false; };
  }, [audience]);
  return <WatchRow videos={videos} base={base} className={className} />;
}

export function WatchRow({ videos: all, base, className }: { videos: HelpVideoListed[]; base: "/help" | "/guides"; className?: string }) {
  const videos = all.slice(0, MAX);
  if (videos.length === 0) return null;
  return (
    <section className={className ? `${className} ${styles.row}` : styles.row} aria-labelledby="watch-and-learn" data-qb-section="watch-and-learn">
      <h2 id="watch-and-learn">Watch and learn</h2>
      <p className={styles.sub}>Short how-to videos. Press one to see it on its guide.</p>
      <ul className={styles.track}>
        {videos.map((v) => {
          const length = formatDuration(v.duration_seconds);
          const inner = (
            <>
              <span className={styles.thumb}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbnailUrl(v.youtube_id)} alt="" loading="lazy" />
                <span className={styles.play} aria-hidden="true">▶</span>
                {length && <span className={styles.len} aria-hidden="true">{length}</span>}
              </span>
              <span className={styles.title}>{v.title}</span>
              {v.guide && <span className={styles.on}>In: {v.guide.title}</span>}
            </>
          );
          return (
            <li key={v.id}>
              {v.guide
                ? <Link className={styles.card} href={`${base}/${v.guide.slug}`} aria-label={`Watch: ${v.title}${length ? ` (${length})` : ""}`}>{inner}</Link>
                : <a className={styles.card} href={watchOnYouTubePath(v.id)} target="_blank" rel="noopener nofollow" aria-label={`Watch on YouTube: ${v.title}${length ? ` (${length})` : ""}`}>{inner}</a>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
