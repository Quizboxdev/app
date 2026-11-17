"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BookOpen, CalendarDays, Megaphone, Trophy, Users, Zap } from "lucide-react";
import { featuredQuizzes, libraryStats } from "@/lib/api/challenges";
import { CONTENT_TYPES, type TargetLevel } from "@/lib/challenges/content-types";
import { type FeaturedQuiz, type LibraryStats, readableText } from "@/lib/challenges/types";
import LogoImage from "./LogoImage";
import styles from "./SponsoredCarousel.module.css";

type DiscoveryFilter = "recommended" | "closing" | "popular" | "recent";
const FILTERS: Array<{ id: DiscoveryFilter; label: string }> = [
  { id: "recommended", label: "For your level" },
  { id: "closing", label: "Closing soon" },
  { id: "popular", label: "Popular with learners" },
  { id: "recent", label: "Recently opened" },
];
const PAGE_SIZE = 6;
const CLOSE_WINDOW = 7 * 24 * 60 * 60 * 1000;

const dateLabel = (iso: string | null) => iso
  ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
  : "No closing date";
const closingSoon = (quiz: FeaturedQuiz, now: number) => {
  const end = quiz.ends_at ? new Date(quiz.ends_at).getTime() : Number.NaN;
  return Number.isFinite(end) && end > now && end <= now + CLOSE_WINDOW;
};
const closeLabel = (iso: string | null, now: number) => {
  if (!iso) return "No closing date";
  const remaining = new Date(iso).getTime() - now;
  const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));
  return days <= 1 ? "Closes today" : `Closes in ${days} days`;
};

// The featured list is level-filtered by the database; local filters only reorder this eligible set.
// It replaces the former auto-advancing carousel so learners can compare opportunities at their own pace.
export default function SponsoredCarousel({ level, compact = false, showLibrary = true }: { level?: TargetLevel; compact?: boolean; showLibrary?: boolean }) {
  const [items, setItems] = useState<FeaturedQuiz[]>([]);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [filter, setFilter] = useState<DiscoveryFilter>("recommended");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    featuredQuizzes(level, 24).then((rows) => { if (alive) setItems(rows); }).catch(() => undefined).finally(() => { if (alive) setLoaded(true); });
    if (showLibrary) libraryStats().then((value) => { if (alive) setStats(value); }).catch(() => undefined);
    return () => { alive = false; };
  }, [level, showLibrary]);

  const now = Date.now();
  const counts = useMemo(() => ({
    recommended: items.length,
    closing: items.filter((item) => closingSoon(item, now)).length,
    popular: items.length,
    recent: items.length,
  }), [items, now]);
  const sorted = useMemo(() => {
    const rows = filter === "closing" ? items.filter((item) => closingSoon(item, now)) : [...items];
    if (filter === "closing") rows.sort((a, b) => new Date(a.ends_at!).getTime() - new Date(b.ends_at!).getTime());
    if (filter === "popular") rows.sort((a, b) => b.participants - a.participants);
    if (filter === "recent") rows.sort((a, b) => new Date(b.starts_at || b.published_at).getTime() - new Date(a.starts_at || a.published_at).getTime());
    return rows;
  }, [filter, items, now]);
  const library = stats && stats.documents > 0 ? CONTENT_TYPES.filter((t) => stats.by_type[t.id]).map((t) => `${stats.by_type[t.id]} ${t.plural}`).join(" · ") : "";

  if (!items.length && !loaded) return <section className={styles.section} aria-label="Sponsored quizzes"><h2>Sponsored quizzes</h2><div className={`qb-card qb-skeleton ${styles.loading}`} aria-busy="true" /></section>;
  if (!items.length) return null;

  return (
    <section className={styles.section} aria-labelledby="sponsored-quizzes-title">
      <header className={styles.heading}>
        <div>
          {!compact && <p className={styles.eyebrow}><Megaphone size={15} aria-hidden="true" /> Discover</p>}
          <h2 id="sponsored-quizzes-title">Sponsored quizzes</h2>
          <p>Open now and selected for your level. Choose one that interests you.</p>
        </div>
        <div className={styles.browseLinks}>
          <Link href="/open">Browse challenges <ArrowRight size={15} aria-hidden="true" /></Link>
          <Link href="/open?format=competition">Browse competitions <ArrowRight size={15} aria-hidden="true" /></Link>
        </div>
      </header>

      <div className={styles.filterRow} role="group" aria-label="Sort sponsored quizzes">
        {FILTERS.map((item) => <button key={item.id} type="button" className={styles.filter} aria-pressed={filter === item.id} onClick={() => { setFilter(item.id); setVisible(PAGE_SIZE); }}>
          {item.label}<span>{counts[item.id]}</span>
        </button>)}
      </div>

      {sorted.length === 0 ? <div className={`qb-card ${styles.empty}`}><strong>No quizzes are closing in the next week.</strong><span>Try another view to see all open opportunities.</span></div> : (
        <div className={styles.grid}>
          {sorted.slice(0, visible).map((quiz) => {
            const accent = quiz.brand?.accent && /^#[0-9a-f]{6}$/i.test(quiz.brand.accent) ? quiz.brand.accent : "#1a7f5a";
            const darkAccent = readableText(accent) ?? "#fff";
            const rounds = quiz.format === "COMPETITION" && quiz.stage_count > 1 ? `${quiz.stage_count} rounds` : quiz.format === "COMPETITION" ? "Competition" : "Challenge";
            return <article key={quiz.slug} className={`qb-card ${styles.card}`} style={{ "--quiz-accent": accent } as React.CSSProperties}>
              <div className={styles.cardHead}>
                <div className={styles.logo} aria-hidden="true">{quiz.brand?.logo ? <LogoImage src={quiz.brand.logo} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <Trophy size={22} color={accent} />}</div>
                <div className={styles.identity}>
                  <p>{quiz.brand?.organiser_name || "QuizBox partner"}<span> · Sponsored</span></p>
                  <span className={styles.liveLabel}>Open now</span>
                </div>
              </div>
              <h3 className={styles.title}><Link href={`/play/${quiz.slug}`}>{quiz.title}</Link></h3>
              {quiz.summary && <p className={styles.summary}>{quiz.summary}</p>}
              <div className={styles.facts}>
                <span><Zap size={14} aria-hidden="true" />{rounds}</span>
                <span><BookOpen size={14} aria-hidden="true" />{quiz.question_count} questions{quiz.has_material ? " · reading included" : ""}</span>
                <span><Users size={14} aria-hidden="true" />{quiz.participants.toLocaleString()} played</span>
                <span><CalendarDays size={14} aria-hidden="true" />{closingSoon(quiz, now) ? closeLabel(quiz.ends_at, now) : quiz.ends_at ? `Closes ${dateLabel(quiz.ends_at)}` : "No closing date"}</span>
              </div>
              <Link href={`/play/${quiz.slug}`} className={styles.takePart} style={{ background: accent, borderColor: accent, color: darkAccent }}>Take part <ArrowRight size={15} aria-hidden="true" /></Link>
            </article>;
          })}
        </div>
      )}

      {sorted.length > visible && <div className={styles.moreRow}><span>Showing {visible} of {sorted.length} open quizzes</span><button type="button" className="qb-btn secondary" onClick={() => setVisible((count) => Math.min(count + PAGE_SIZE, sorted.length))}>Show more</button></div>}
      {!compact && library && <p className={`qb-muted qb-small ${styles.library}`}>Learning materials on QuizBox: {library}.</p>}
    </section>
  );
}
