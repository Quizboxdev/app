"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarDays, Search, Users } from "lucide-react";
import type { Format, PublicChallenge } from "@/lib/challenges/types";
import { formatDuration } from "@/lib/challenges/types";
import LogoImage from "./LogoImage";
import styles from "./OpenCatalogue.module.css";

type Filter = "all" | "sponsored" | "closing" | "popular" | "recent";
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All open" },
  { id: "sponsored", label: "Sponsored" },
  { id: "closing", label: "Closing soon" },
  { id: "popular", label: "Most played" },
  { id: "recent", label: "Recently opened" },
];
const CLOSE_WINDOW = 7 * 24 * 60 * 60 * 1000;
const closingSoon = (item: PublicChallenge, now: number) => {
  const end = item.ends_at ? new Date(item.ends_at).getTime() : Number.NaN;
  return Number.isFinite(end) && end > now && end <= now + CLOSE_WINDOW;
};
const when = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "No closing date";

export default function OpenCatalogue({ items, format, page, hasNext }: { items: PublicChallenge[]; format: Format; page: number; hasNext: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const now = Date.now();
  const counts = useMemo(() => ({
    all: items.length,
    sponsored: items.filter((item) => item.sponsored).length,
    closing: items.filter((item) => closingSoon(item, now)).length,
    popular: items.length,
    recent: items.length,
  }), [items, now]);
  const rows = useMemo(() => {
    let next = filter === "sponsored" ? items.filter((item) => item.sponsored)
      : filter === "closing" ? items.filter((item) => closingSoon(item, now)) : [...items];
    const term = query.trim().toLocaleLowerCase();
    if (term) next = next.filter((item) => `${item.title} ${item.summary} ${item.brand?.organiser_name ?? ""}`.toLocaleLowerCase().includes(term));
    if (filter === "closing") next.sort((a, b) => new Date(a.ends_at!).getTime() - new Date(b.ends_at!).getTime());
    if (filter === "popular") next.sort((a, b) => b.participants - a.participants);
    if (filter === "recent") next.sort((a, b) => new Date(b.starts_at ?? 0).getTime() - new Date(a.starts_at ?? 0).getTime());
    return next;
  }, [filter, items, now, query]);
  const kind = format === "COMPETITION" ? "competition" : "challenge";

  return <section className={styles.catalogue} aria-label={`Open ${kind}s`}>
    <div className={styles.controls}>
      <div className={styles.filters} role="group" aria-label={`Filter open ${kind}s`}>
        {FILTERS.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
          {item.label}<span>{counts[item.id]}</span>
        </button>)}
      </div>
      <label className={styles.search}><Search size={17} aria-hidden="true" /><span className="qb-sr-only">Search open {kind}s</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${kind}s or organisers`} /></label>
    </div>

    {rows.length === 0 ? <div className={`qb-card ${styles.empty}`}><strong>No matching {kind}s</strong><span>Change your search or choose another filter.</span></div> : <>
      <div className={styles.grid}>
        {rows.map((item) => <article className={`qb-card ${styles.card}`} key={item.slug}>
          <div className={styles.cardHead}>
            {item.brand?.logo && <div className={styles.logo}><LogoImage src={item.brand.logo} width={42} height={42} style={{ objectFit: "contain" }} /></div>}
            <div className={styles.brand}><span>{item.brand?.organiser_name ?? "QuizBox community"}</span><span className={item.sponsored ? styles.sponsored : styles.category}>{item.sponsored ? "Sponsored" : item.category.replaceAll("_", " ")}</span></div>
            <span className={styles.live}>Open</span>
          </div>
          <h2><Link href={`/play/${item.slug}`}>{item.title}</Link></h2>
          {item.summary && <p className={styles.summary}>{item.summary}</p>}
          <div className={styles.facts}>
            {format === "COMPETITION" && (item.stage_count ?? 1) > 1 && <span>{item.stage_count} rounds</span>}
            <span>{item.question_count} questions</span>
            <span>{formatDuration(item.time_limit_seconds * 1000)}</span>
            <span><Users size={14} aria-hidden="true" />{item.participants.toLocaleString()} played</span>
            <span><CalendarDays size={14} aria-hidden="true" />{item.ends_at ? `Closes ${when(item.ends_at)}` : "No closing date"}</span>
          </div>
          <Link className="qb-btn" style={{ justifySelf: "start", marginTop: 2 }} href={`/play/${item.slug}`}>{format === "COMPETITION" ? "View competition" : "Take part"}</Link>
        </article>)}
      </div>
      <footer className={styles.footer}>
        <span>Showing {rows.length} on this page</span>
        <nav aria-label="More open quizzes">
          {page > 1 && <Link className="qb-btn secondary" href={`/open${format === "COMPETITION" ? "?format=competition&" : "?"}page=${page - 1}`}>Previous page</Link>}
          {hasNext && <Link className="qb-btn secondary" href={`/open${format === "COMPETITION" ? "?format=competition&" : "?"}page=${page + 1}`}>Next page</Link>}
        </nav>
      </footer>
    </>}
  </section>;
}
