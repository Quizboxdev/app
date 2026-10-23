"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { HELP_CATEGORIES, type HelpMeta } from "@/lib/help/categories";

// The Help home: a search box that answers as you type, then the guides grouped by topic. Used on the public site (/help) and inside the app (/guides, inside the signed-in menu).
// Search asks the server (it searches the steps too, not only titles); the topic list works without any search. A "Still stuck?" box leads to a support request or the contact form.
export default function HelpHome({ guides, base, audience, inApp }: { guides: HelpMeta[]; base: "/help" | "/guides"; audience: string | null; inApp: boolean }) {
  const [q, setQ] = useState(""), [results, setResults] = useState<HelpMeta[] | null>(null), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); setBusy(false); setFailed(false); return; }
    const mine = ++seq.current; setBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/help/search?q=${encodeURIComponent(term)}${audience ? `&audience=${audience}` : ""}`);
        const body = await res.json();
        if (mine === seq.current) { setResults(Array.isArray(body?.results) ? body.results : []); setFailed(!res.ok); setBusy(false); }
      } catch { if (mine === seq.current) { setResults([]); setFailed(true); setBusy(false); } }
    }, 250);
    return () => clearTimeout(t);
  }, [q, audience]);

  const popular = useMemo(() => [...guides].filter((g) => (g.views ?? 0) > 0).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 5), [guides]);
  const byCategory = useMemo(() => HELP_CATEGORIES.map((c) => ({ ...c, items: guides.filter((g) => g.category === c.id) })).filter((c) => c.items.length > 0), [guides]);
  const link = inApp ? "qb-link" : "qbp-link", card = inApp ? "qb-card" : "qbp-card";
  const supportHref = inApp ? "/support/new" : "/contact";

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div className={card} style={{ display: "grid", gap: 8 }}>
        <label htmlFor="help-search" style={{ fontWeight: 700 }}>What do you need help with?</label>
        <input id="help-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try: class code, refund, share a challenge, password" autoComplete="off" style={{ fontSize: 18, padding: 12, width: "100%", boxSizing: "border-box" }} />
        <div aria-live="polite" className={inApp ? "qb-muted qb-small" : "qbp-meta"}>{busy ? "Searching…" : results !== null ? (results.length === 0 ? "No guide matches that yet." : `${results.length} guide${results.length === 1 ? "" : "s"} found`) : ""}</div>
      </div>

      {results !== null ? (
        <div className={card}>
          {results.length > 0 && <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>{results.map((g) => <li key={g.slug}><Link className={link} href={`${base}/${g.slug}`}><strong>{g.title}</strong></Link><span style={{ display: "block", opacity: 0.8 }}>{g.summary}</span></li>)}</ul>}
          {failed && <p role="status">Search is not available right now. You can still browse the guides below.</p>}
          {results.length === 0 && <p>We could not find a guide for that. Try other words, or <Link className={link} href={supportHref}>{inApp ? "send us a support request" : "contact us"}</Link>.</p>}
        </div>
      ) : (
        <>
          {popular.length > 0 && !audience && <div className={card}><h2 style={{ marginTop: 0 }}>Most read</h2><ul style={{ margin: 0 }}>{popular.map((g) => <li key={g.slug}><Link className={link} href={`${base}/${g.slug}`}>{g.title}</Link></li>)}</ul></div>}
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {byCategory.map((c) => (
              <section key={c.id} className={card} aria-labelledby={`help-cat-${c.id}`}>
                <h2 id={`help-cat-${c.id}`} style={{ marginTop: 0, fontSize: 18 }}>{c.label}</h2>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 }}>{c.items.map((g) => <li key={g.slug}><Link className={link} href={`${base}/${g.slug}`}>{g.title}</Link><span style={{ display: "block", opacity: 0.75, fontSize: 14 }}>{g.summary}</span></li>)}</ul>
              </section>
            ))}
          </div>
          {guides.length === 0 && <div className={card}><p>The guides are not available right now. Please try again in a moment, or <Link className={link} href={supportHref}>ask us directly</Link>.</p></div>}
        </>
      )}

      <div className={card}>
        <h2 style={{ marginTop: 0 }}>Still stuck?</h2>
        <p>{inApp ? "If a guide did not solve it, send us a support request and attach a screenshot." : "If a guide did not solve it, send us a message and attach a screenshot."}</p>
        <Link className={inApp ? "qb-btn" : "qbp-btn"} href={supportHref}>{inApp ? "Send a support request" : "Contact us"}</Link>
      </div>
    </div>
  );
}
