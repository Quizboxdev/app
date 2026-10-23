"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { catalog, cedis, GRADE_OPTIONS, marketplaceOpen, SUBJECT_SUGGESTIONS, type Listing } from "@/lib/api/marketplace";
import HelpLink from "@/components/help/HelpLink";

// The Marketplace shelf: end-of-term question sets from verified teachers. Every card names its source (subject and school) so a buyer knows exactly where a set comes from.
export default function MarketplacePage() {
  const [open, setOpen] = useState<boolean | null>(null), [items, setItems] = useState<Listing[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [q, setQ] = useState(""), [subject, setSubject] = useState(""), [grade, setGrade] = useState(""), [school, setSchool] = useState("");

  useEffect(() => { marketplaceOpen().then(setOpen); }, []);
  useEffect(() => {
    if (open === false) { setLoading(false); return; }
    if (open === null) return;
    const t = setTimeout(() => {
      setLoading(true); setError("");
      catalog({ q, subject, grade, school }).then(setItems).catch((e) => setError(e.message)).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [open, q, subject, grade, school]);

  const schools = useMemo(() => [...new Set(items.map((i) => i.school))].sort(), [items]);
  const clear = () => { setQ(""); setSubject(""); setGrade(""); setSchool(""); };

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Marketplace</h1>
          <p>End-of-term question sets written by verified teachers. Buy a set and practise it for 90 days.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="qb-btn" href="/marketplace/mine">My question sets</Link>
          <HelpLink slug="buy-a-question-set" label="How buying works" />
        </div>
      </div>

      {open === false && <div className="qb-card"><h3>The Marketplace is not open yet</h3><p className="qb-muted">Teachers are getting their question sets ready. Please check back soon.</p></div>}
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}

      {open && <>
        <div className="qb-card qb-form" style={{ marginBottom: 16 }}>
          <div className="qb-grid cols-4">
            <label className="qb-field" style={{ gridColumn: "span 2" }}>Search<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Subject, school or title, e.g. Chemistry Opoku Ware" /></label>
            <label className="qb-field">Subject<select value={subject} onChange={(e) => setSubject(e.target.value)}><option value="">All subjects</option>{SUBJECT_SUGGESTIONS.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="qb-field">Class<select value={grade} onChange={(e) => setGrade(e.target.value)}><option value="">All classes</option>{GRADE_OPTIONS.map((g) => <option key={g}>{g}</option>)}</select></label>
            {schools.length > 1 || school ? <label className="qb-field">School<select value={school} onChange={(e) => setSchool(e.target.value)}><option value="">All schools</option>{(school && !schools.includes(school) ? [school, ...schools] : schools).map((s) => <option key={s}>{s}</option>)}</select></label> : null}
          </div>
          {(q || subject || grade || school) && <button className="qb-btn secondary" style={{ justifySelf: "start" }} onClick={clear}>Clear filters</button>}
        </div>

        {loading && !items.length ? <div className="qb-card qb-muted">Loading…</div> :
          !items.length ? <div className="qb-card qb-muted">{q || subject || grade || school ? "Nothing matches. Try fewer filters." : "No question sets are on sale yet."}</div> :
          <div className="qb-grid cols-3">
            {items.map((i) => (
              <Link key={i.slug} href={`/marketplace/${i.slug}`} className="qb-card" style={{ display: "grid", gap: 8, alignContent: "start", textDecoration: "none", color: "inherit" }}>
                <span className="qb-pill teal" style={{ justifySelf: "start" }}>{i.subject} · {i.school}</span>
                <h3 style={{ margin: 0 }}>{i.title}</h3>
                <p className="qb-muted qb-small" style={{ margin: 0 }}>{[i.grade, i.term, `${i.questions} questions`].filter(Boolean).join(" · ")}</p>
                {i.summary && <p className="qb-small" style={{ margin: 0 }}>{i.summary}</p>}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
                  <strong style={{ fontSize: 18 }}>{cedis(i.price_minor)}</strong>
                  <span className="qb-small qb-muted">by {i.seller}{i.purchases > 0 ? ` · ${i.purchases} bought` : ""}</span>
                </div>
              </Link>
            ))}
          </div>}
      </>}
    </>
  );
}
