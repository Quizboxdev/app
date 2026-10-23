"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { downloadExport, exportCatalog, previewExport, type ExportDataset, type ExportPreview } from "@/lib/api/exports";
import { PRESETS } from "@/lib/exports/presets";

// Export data from any admin tool as CSV (opens in Excel or Google Sheets) or a real Excel file. Choose the data, the dates and a category, check the preview, then download.
// You only see what your role allows. A real export is recorded in the audit log. Times are UTC; money is in whole currency units.
const shown = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v));

function Exports() {
  const asked = useSearchParams().get("dataset");
  const [sets, setSets] = useState<ExportDataset[] | null>(null), [error, setError] = useState(""), [note, setNote] = useState("");
  const [dataset, setDataset] = useState(""), [preset, setPreset] = useState("30d"), [from, setFrom] = useState(""), [to, setTo] = useState(""), [category, setCategory] = useState("");
  const [preview, setPreview] = useState<ExportPreview | null>(null), [loading, setLoading] = useState(false), [busy, setBusy] = useState("");

  useEffect(() => { exportCatalog().then((s) => { setSets(s); setDataset(s.find((d) => d.key === asked)?.key ?? s[0]?.key ?? ""); }).catch((e) => { setError(e.message); setSets([]); }); }, [asked]);
  const current = sets?.find((d) => d.key === dataset) ?? null;

  // A preset fills in the dates; typing a date switches to "custom".
  useEffect(() => { const p = PRESETS.find((x) => x.id === preset); if (!p) return; const r = p.range(new Date()); setFrom(r.from ?? ""); setTo(r.to ?? ""); }, [preset]);
  useEffect(() => { setCategory(""); setPreview(null); setNote(""); }, [dataset]);
  const rangeBad = !!from && !!to && to < from;
  const query = useMemo(() => ({ dataset, from: from || null, to: to || null, category: category || null }), [dataset, from, to, category]);

  useEffect(() => {
    if (!dataset || rangeBad) { setPreview(null); return; }
    let live = true; setLoading(true); setError("");
    const t = setTimeout(() => { previewExport(query).then((p) => { if (live) setPreview(p); }).catch((e) => { if (live) { setPreview(null); setError(e.message); } }).finally(() => { if (live) setLoading(false); }); }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [query, dataset, rangeBad]);

  async function download(format: "csv" | "xlsx") {
    setBusy(format); setError(""); setNote("");
    try { const r = await downloadExport(query, format); setNote(r.rows < r.total ? `Downloaded ${r.rows.toLocaleString("en-GB")} of ${r.total.toLocaleString("en-GB")} rows. The file holds at most 50,000: narrow the dates or the category and export again for the rest.` : `Downloaded ${r.rows.toLocaleString("en-GB")} row${r.rows === 1 ? "" : "s"}.`); }
    catch (e: any) { setError(e.message); }
    setBusy("");
  }
  const groups = useMemo(() => [...new Set((sets ?? []).map((d) => d.group))], [sets]);

  return (
    <>
      <div className="qb-page-head"><div><h1>Export data</h1><p>Download data from the admin tools as a CSV or Excel file to filter and analyse. Pick the data, the dates and a category.</p></div></div>
      {error && <div className="qb-card qb-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
      {sets === null ? <div className="qb-card qb-muted">Loading…</div> : !sets.length ? <div className="qb-card qb-muted">Your role has no data to export.</div> : (
        <div style={{ display: "grid", gap: 16 }}>
          <section className="qb-card qb-form" style={{ display: "grid", gap: 12 }}>
            <label className="qb-field">What to export
              <select value={dataset} onChange={(e) => setDataset(e.target.value)}>{groups.map((g) => <optgroup key={g} label={g}>{sets.filter((d) => d.group === g).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</optgroup>)}</select>
            </label>
            {current && <p className="qb-small qb-muted" style={{ margin: 0 }}>{current.description}</p>}

            {current?.date_label && <>
              <div role="group" aria-label="Date range" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {PRESETS.map((p) => <button key={p.id} type="button" className={`qb-btn ${preset === p.id ? "" : "secondary"}`} aria-pressed={preset === p.id} onClick={() => setPreset(p.id)}>{p.label}</button>)}
              </div>
              <div className="qb-grid cols-2">
                <label className="qb-field">{current.date_label} from<input type="date" value={from} max={to || undefined} onChange={(e) => { setPreset("custom"); setFrom(e.target.value); }} /></label>
                <label className="qb-field">{current.date_label} until (included)<input type="date" value={to} min={from || undefined} onChange={(e) => { setPreset("custom"); setTo(e.target.value); }} /></label>
              </div>
              {rangeBad && <p className="qb-error" role="alert" style={{ margin: 0 }}>The end date must not be before the start date.</p>}
            </>}

            {current?.categories && <label className="qb-field" style={{ maxWidth: 320 }}>{current.category_label}
              <select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All</option>{current.categories.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select>
            </label>}
            {current && !current.categories && <label className="qb-field" style={{ maxWidth: 320 }}>{current.category_label} (type the exact name, or leave empty for all)<input value={category} onChange={(e) => setCategory(e.target.value)} /></label>}
          </section>

          <section className="qb-card" style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <strong role="status">{loading ? "Checking…" : preview ? `${preview.total.toLocaleString("en-GB")} row${preview.total === 1 ? "" : "s"} match` : rangeBad ? "" : "—"}</strong>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="qb-btn" disabled={!!busy || loading || !preview?.total} onClick={() => void download("xlsx")}>{busy === "xlsx" ? "Preparing…" : "Download Excel (.xlsx)"}</button>
                <button className="qb-btn secondary" disabled={!!busy || loading || !preview?.total} onClick={() => void download("csv")}>{busy === "csv" ? "Preparing…" : "Download CSV"}</button>
              </div>
            </div>
            {note && <p className="qb-ok" role="status" style={{ margin: 0 }}>{note}</p>}
            {preview && preview.total > 50000 && <p className="qb-small qb-muted" style={{ margin: 0 }}>A file holds at most 50,000 rows (the newest). Narrow the dates or the category to export the rest in parts.</p>}
            {preview && !!preview.rows.length && <>
              <p className="qb-small qb-muted" style={{ margin: 0 }}>Preview of the newest {preview.rows.length}:</p>
              <div className="qb-table-wrap"><table className="qb-table"><thead><tr>{preview.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{preview.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="qb-small">{shown(v)}</td>)}</tr>)}</tbody></table></div>
            </>}
            {preview && !preview.total && <p className="qb-muted" style={{ margin: 0 }}>Nothing matches these dates and this category.</p>}
          </section>

          <p className="qb-small qb-muted">Times are UTC (Ghana time is the same). Money is in whole units, for example 40 means GHS 40. Files can hold personal data: save them somewhere safe and delete them when you are done. Each real download is recorded in the audit log. Teacher-managed children are never included, learners in results appear only as a code, and bank or mobile-money numbers are never exported.</p>
        </div>
      )}
    </>
  );
}
export default function ExportsPage() { return <Suspense fallback={<div className="qb-card qb-muted">Loading…</div>}><Exports /></Suspense>; }
