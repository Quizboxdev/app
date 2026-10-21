"use client";

import { useEffect, useState } from "react";
import { featuredQuizzes, libraryStats } from "@/lib/api/challenges";
import { CONTENT_TYPES, type TargetLevel } from "@/lib/challenges/content-types";
import type { FeaturedQuiz, LibraryStats } from "@/lib/challenges/types";
import SpotlightCard from "./SpotlightCard";

// Sponsored quizzes, shown on the home pages after sign-in: one slide at a time, moving on by itself (not for people who prefer less motion, and never while the pointer or focus is on it),
// with previous and next buttons and dots. Quiet when nothing is live. The compact form is for the sidebar. Also shows how much material QuizBox hosts.
export default function SponsoredCarousel({ level, compact = false, showLibrary = true }: { level?: TargetLevel; compact?: boolean; showLibrary?: boolean }) {
  const [items, setItems] = useState<FeaturedQuiz[]>([]), [stats, setStats] = useState<LibraryStats | null>(null), [i, setI] = useState(0), [hold, setHold] = useState(false);
  useEffect(() => {
    let alive = true;
    featuredQuizzes(level).then((r) => { if (alive) setItems(r); }).catch(() => undefined);
    if (showLibrary) libraryStats().then((s) => { if (alive) setStats(s); }).catch(() => undefined);
    return () => { alive = false; };
  }, [level, showLibrary]);
  useEffect(() => {
    if (items.length < 2 || hold || (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)) return;
    const t = setInterval(() => setI((n) => (n + 1) % items.length), 6500);
    return () => clearInterval(t);
  }, [items.length, hold]);
  if (!items.length) return null;
  const cur = items[Math.min(i, items.length - 1)];
  const go = (d: number) => setI((n) => (n + d + items.length) % items.length);
  const library = stats && stats.documents > 0 ? CONTENT_TYPES.filter((t) => stats.by_type[t.id]).map((t) => `${stats.by_type[t.id]} ${t.plural}`).join(" · ") : "";
  return (
    <section aria-roledescription="carousel" aria-label="Sponsored quizzes" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)} style={{ margin: "0 0 16px" }}>
      {!compact && <h2 style={{ marginBottom: 8 }}>Sponsored quizzes</h2>}
      <div aria-live={hold ? "polite" : "off"}>
        <SpotlightCard compact={compact} title={cur.title} summary={cur.summary} brand={cur.brand} format={cur.format} rounds={cur.stage_count} questions={cur.question_count} hasMaterial={cur.has_material} played={cur.participants} href={`/play/${cur.slug}`} />
      </div>
      {items.length > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <button type="button" className="qb-btn qb-btn-secondary" onClick={() => go(-1)} aria-label="Previous quiz">‹</button>
          <span role="tablist" aria-label="Choose a quiz" style={{ display: "flex", gap: 6 }}>
            {items.map((x, k) => <button key={x.slug} role="tab" type="button" aria-selected={k === i} aria-label={`Show ${x.title}`} onClick={() => setI(k)} style={{ width: 10, height: 10, borderRadius: "50%", border: 0, padding: 0, background: k === i ? "currentColor" : "rgba(128,128,128,.4)" }} />)}
          </span>
          <button type="button" className="qb-btn qb-btn-secondary" onClick={() => go(1)} aria-label="Next quiz">›</button>
        </div>
      )}
      {!compact && library && <p className="qb-muted qb-small" style={{ marginTop: 8 }}>On QuizBox now: {library}.</p>}
    </section>
  );
}
