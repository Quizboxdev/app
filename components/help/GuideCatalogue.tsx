"use client";

import Link from "next/link";
import { useRef } from "react";
import { ArrowRight, Search } from "lucide-react";
import { HELP_AUDIENCES, type HelpMeta } from "@/lib/help/categories";
import styles from "./GuideCatalogue.module.css";

// Only audiences supported by the existing list/search contracts are offered.
export const GUIDE_TABS = [{ id: "all", label: "All guides", audience: null }, ...HELP_AUDIENCES.filter(a => a.id !== "everyone").map(a => ({ ...a, audience: a.id }))];
type Props = { guides: HelpMeta[] | null; audience: string | null; query: string; failed: boolean; onAudience: (value: string | null) => void; onQuery: (value: string) => void; onRetry: () => void };

function GuideCard({ guide }: { guide: HelpMeta }) {
  const audience = guide.audiences.map(id => HELP_AUDIENCES.find(a => a.id === id)?.label).filter(Boolean).join(" · ");
  return <Link className={styles.card} href={`/guides/${guide.slug}`}>
    {audience && <span className={styles.category}>{audience}</span>}
    <h2>{guide.title}</h2><p>{guide.summary}</p>
    <span className={styles.read}>Read the guide <ArrowRight size={16} aria-hidden="true" /></span>
  </Link>;
}

export default function GuideCatalogue({ guides, audience, query, failed, onAudience, onQuery, onRetry }: Props) {
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const active = GUIDE_TABS.findIndex(t => t.audience === audience);
  return <div className={styles.catalogue} data-design="canvas11-guides">
    <header className={styles.header}><p className={styles.eyebrow}>Guides</p><h1>Step-by-step guides</h1><p>Longer how-tos for getting set up and getting the most from QuizBox. Pick the one for your role.</p></header>
    <div className={styles.tabs} role="tablist" aria-label="Guides for your role">{GUIDE_TABS.map((tab, i) => <button className={`qb-btn ${styles.tab}`} key={tab.id} ref={element => { tabs.current[i] = element; }} type="button" role="tab" id={`guide-tab-${tab.id}`} aria-selected={i === active} aria-controls="guides-panel" tabIndex={i === active ? 0 : -1} onClick={() => onAudience(tab.audience)} onKeyDown={event => {
      const next = event.key === "ArrowRight" ? (i + 1) % GUIDE_TABS.length : event.key === "ArrowLeft" ? (i - 1 + GUIDE_TABS.length) % GUIDE_TABS.length : event.key === "Home" ? 0 : event.key === "End" ? GUIDE_TABS.length - 1 : null;
      if (next !== null) { event.preventDefault(); onAudience(GUIDE_TABS[next].audience); tabs.current[next]?.focus(); }
    }}>{tab.label}</button>)}</div>
    <div className={styles.search} role="search"><label htmlFor="guides-search" className={styles.sr}>Search guides</label><Search size={18} aria-hidden="true" /><input id="guides-search" type="search" value={query} onChange={event => onQuery(event.target.value)} placeholder="Search guides" autoComplete="off" /></div>
    <section id="guides-panel" role="tabpanel" aria-labelledby={`guide-tab-${GUIDE_TABS[active]?.id ?? "all"}`} tabIndex={0} aria-busy={guides === null && !failed} className={styles.panel}>
      {failed ? <div className={styles.state} role="status"><h2>We could not load these guides</h2><p>Check your connection and try again.</p><button type="button" className="qb-btn qb-btn-secondary" onClick={onRetry}>Try again</button></div> : guides === null ? <div role="status"><p>Loading guides…</p><div className={styles.grid} aria-hidden="true">{[0, 1, 2].map(n => <div className={styles.skeleton} key={n} />)}</div></div> : guides.length === 0 ? <div className={styles.state} role="status"><h2>{query.trim().length >= 2 ? "No guides match your search" : "No guides available for this role"}</h2><p>{query.trim().length >= 2 ? "Try a different search, or clear it to browse guides." : "Check another role, or ask support for help."}</p><div className="qb-actions">{query && <button type="button" className="qb-btn qb-btn-secondary" onClick={() => onQuery("")}>Clear search</button>}{audience && <button type="button" className="qb-btn qb-btn-secondary" onClick={() => onAudience(null)}>All guides</button>}<Link className="qb-link" href="/support/new">Contact support</Link></div></div> : <div className={styles.grid}>{guides.map(guide => <GuideCard key={guide.slug} guide={guide} />)}</div>}
    </section>
  </div>;
}
