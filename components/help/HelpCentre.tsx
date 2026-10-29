"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { HELP_CATEGORIES, categoryLabel, type HelpMeta } from "@/lib/help/categories";
import styles from "./HelpCentre.module.css";

// Canvas 11 presentation. Article content, categories and popularity remain server-owned.
export default function HelpCentre({ guides, unavailable = false }: { guides: HelpMeta[]; unavailable?: boolean }) {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  const [results, setResults] = useState<HelpMeta[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const term = query.trim();
    setResults(null);
    if (term.length < 2) { setState("idle"); return () => controller.abort(); }
    setState("loading");
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/help/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        const body: { results?: HelpMeta[] } = await response.json();
        if (!response.ok || !Array.isArray(body.results)) throw new Error("HELP_SEARCH_UNAVAILABLE");
        if (!controller.signal.aborted) { setResults(body.results); setState("idle"); }
      } catch { if (!controller.signal.aborted) setState("error"); }
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [query, retry]);

  const topics = useMemo(() => HELP_CATEGORIES.map(c => ({ ...c, articles: guides.filter(g => g.category === c.id) })).filter(c => c.articles.length), [guides]);
  const popular = useMemo(() => [...guides].filter(g => (g.views ?? 0) > 0).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 5), [guides]);
  const selected = topic ? guides.filter(g => g.category === topic) : null;
  const articleList = (items: HelpMeta[]) => <ul className={styles.articles}>{items.map(g => <li key={g.slug}><Link href={`/help/${g.slug}`}>{g.title}</Link><span>{g.summary}</span></li>)}</ul>;
  return <div className={styles.centre} data-design="canvas11-help">
    <section className={`qbp-wrap ${styles.intro}`}>
      <p className="qbp-eyebrow">Help centre</p>
      <h1>How can we help?</h1>
      <p className={styles.lead}>Answers for learners, guardians, teachers, schools, sponsors and reviewers. Search, or pick a topic.</p>
      <div role="search" className={styles.search}>
        <label htmlFor="help-centre-search" className={styles.sr}>Search help articles</label>
        <Search size={18} aria-hidden="true" />
        <input id="help-centre-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search, for example: Coins, reset a PIN, join a class" autoComplete="off" />
      </div>
      <div aria-live="polite" aria-atomic="true" aria-busy={state === "loading"}>
        {state === "loading" && <p role="status">Searching help articles…</p>}
        {state === "error" && <div className={styles.panel} role="status"><h2>Help search could not load</h2><p>Please try again, or browse the topics below.</p><button type="button" className="qbp-btn2" onClick={() => setRetry(n => n + 1)}>Try again</button></div>}
        {results?.length === 0 && <div className={styles.panel}><h2>No articles match “{query.trim()}”</h2><p>Check the spelling or try a different search.</p><button className="qbp-btn2" type="button" onClick={() => setQuery("")}>Clear search</button></div>}
      </div>
      {results && results.length > 0 && <section aria-label="Search results"><h2>Search results</h2>{articleList(results)}</section>}
    </section>
    <section className={styles.band} aria-labelledby="help-topics-title"><div className={`qbp-wrap ${styles.stack}`}>
      <h2 id="help-topics-title">Browse by topic</h2>
      {unavailable ? <div className={styles.panel} role="status"><h3>Help articles could not load</h3><p>Please try again in a moment.</p><button type="button" onClick={() => window.location.reload()} className="qbp-btn2">Try again</button></div> : topics.length === 0 ? <div className={styles.panel}><h3>No articles available yet</h3><p>Please check back, or contact support.</p></div> : <div className={styles.topics}>{topics.map(c => <button type="button" key={c.id} className={styles.topic} aria-pressed={topic === c.id} aria-controls="help-topic-articles" onClick={() => { setTopic(c.id); setQuery(""); }}><strong>{c.label}</strong><span>Articles: {c.articles.length}</span></button>)}</div>}
      <div id="help-topic-articles">{selected && <section aria-label="Selected topic"><h3>{categoryLabel(topic ?? "")}</h3>{articleList(selected)}<button type="button" className="qbp-btn2" onClick={() => setTopic(null)}>All topics</button></section>}</div>
    </div></section>
    {popular.length > 0 && <section className={`qbp-wrap ${styles.section}`} aria-labelledby="help-popular-title"><h2 id="help-popular-title">Popular articles</h2><ul className={styles.popular}>{popular.map(g => <li key={g.slug}><Link href={`/help/${g.slug}`}>{g.title}<span>{categoryLabel(g.category)}</span></Link></li>)}</ul></section>}
    <section className={`qbp-wrap ${styles.section}`}><div className={styles.panel}><h2>Still need help?</h2><p>Tell us what happened and which account you are using. Never send a password or PIN.</p><dl className={styles.contacts}><div><dt>Email</dt><dd>[support email]</dd></div><div><dt>Phone</dt><dd>[support phone]</dd></div><div><dt>Hours</dt><dd>[support hours]</dd></div></dl><Link className="qbp-btn" href="/contact">Contact support</Link></div></section>
  </div>;
}
