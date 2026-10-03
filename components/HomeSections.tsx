"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getHome, type Home } from "@/lib/api/platform";
import { resolveLocale, t } from "@/lib/i18n";

// Role home: every number and list is computed by qb_home on the server for the user's market.
export default function HomeSections({ only }: { only?: string[] }) {
  const [home, setHome] = useState<Home | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(true);
  const load = useCallback(async () => { setBusy(true); setError(""); try { setHome(await getHome()); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const locale = resolveLocale([home?.locale]);
  if (busy && !home) return <p className="qb-muted" role="status">{t("home.loading", locale)}</p>;
  if (error && !home) return <div className="qb-card qb-error" role="alert">{t("home.error", locale)} {error} <button className="qb-btn secondary" onClick={() => void load()}>{t("common.retry", locale)}</button></div>;
  const sections = (home?.sections ?? []).filter((s) => !only || only.includes(s.key));
  return <div className="qb-home" aria-busy={busy}>
    <div className="qb-page-head"><span className="qb-muted">{home?.market ?? ""}</span><button className="qb-btn ghost" title="Refresh" aria-label="Refresh dashboard" onClick={() => void load()} disabled={busy}><RefreshCw size={16}/></button></div>
    <div className="qb-home-grid">{sections.map((s) => <section key={s.key} className="qb-card" aria-labelledby={`home-${s.key}`}>
      <h2 id={`home-${s.key}`}>{s.href ? <Link href={s.href}>{s.title}</Link> : s.title}</h2>
      {s.kind === "stats" && <dl className="qb-stat-list">{(s.stats ?? []).map((x) => <div key={x.label}><dt>{x.label}</dt><dd>{String(x.value ?? "-")}</dd></div>)}</dl>}
      {s.kind === "list" && ((s.items ?? []).length ? <ul className="qb-plain-list">{(s.items ?? []).slice(0, 8).map((item, i) => <li key={`${item.title}-${i}`}>
        {item.href ? <Link href={item.href}>{item.title}</Link> : <strong>{item.title}</strong>}{item.subtitle && <span className="qb-muted"> · {item.subtitle}</span>}{item.meta && <span className="qb-small qb-muted"> · {item.meta}</span>}</li>)}</ul>
        : <p className="qb-muted">{s.empty ?? t("home.empty", locale)}</p>)}
      {s.actions?.length ? <div className="qb-content-filters">{s.actions.map((a) => <Link key={a.href} className="qb-btn secondary" href={a.href}>{a.label}</Link>)}</div> : null}
    </section>)}</div>
  </div>;
}
