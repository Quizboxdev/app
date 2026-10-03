"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { search, type SearchHit } from "@/lib/api/platform";
import { t } from "@/lib/i18n";

// Market-aware search. Results are authorized and scoped by qb_search on the server.
export default function GlobalSearch() {
  const [query, setQuery] = useState(""), [hits, setHits] = useState<SearchHit[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const seq = useRef(0);
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setHits(null); return; }
    const id = ++seq.current; setBusy(true);
    const timer = window.setTimeout(() => {
      search(term)
        .then((r) => { if (id === seq.current) { setHits(r); setError(""); } })
        .catch((e) => { if (id === seq.current) setError((e as Error).message); })
        .finally(() => { if (id === seq.current) setBusy(false); });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  return <div className="qb-search" role="search">
    <label className="qb-sr-only" htmlFor="qb-global-search">{t("search.label")}</label>
    <Search size={16} aria-hidden/>
    <input id="qb-global-search" type="search" value={query} placeholder={t("search.placeholder")} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }} autoComplete="off"/>
    {query.trim().length >= 2 && <div className="qb-search-results" aria-label="Search results" aria-busy={busy}>
      {error ? <p className="qb-error" role="alert">{error}</p>
        : hits === null ? <p className="qb-muted">{t("common.loading")}</p>
        : hits.length ? hits.map((h, i) => <Link key={`${h.href}-${i}`} href={h.href} onClick={() => setQuery("")}><span className="qb-small qb-muted">{h.kind}</span> {h.title}{h.subtitle && <span className="qb-muted"> · {h.subtitle}</span>}</Link>)
        : <p className="qb-muted">{t("search.empty")}</p>}
    </div>}
  </div>;
}
