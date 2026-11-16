"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import {
  adminDecideSchool, adminImportSchools, adminListSchools, adminSchoolStats, adminUpdateSchool, LEVEL_LABEL, OWNERSHIP_LABEL,
  type AdminListFilter, type AdminSchool, type AdminSchoolList, type AdminSort, type DirectoryStatus, type Ownership, type SchoolFix, type SchoolLevel, type SchoolStats,
} from "@/lib/api/schools";
import { chunkRows, readSchoolCsv, type ParsedSchools } from "@/lib/schools/csv";
import { formatDate } from "@/lib/format";
import { Kpi, Panel, RankedBars, Segmented, SERIES, SplitBar, TrendCurve, num } from "@/components/admin/DataViz";

type Tab = DirectoryStatus | "import";
const LEVELS: SchoolLevel[] = ["primary", "jhs", "shs"];
const SIZES = [25, 50, 100];
type Draft = { name: string; district: string; town: string; ownership: Ownership | ""; levels: SchoolLevel[] };
const draftOf = (s: AdminSchool): Draft => ({ name: s.name, district: s.district, town: s.town ?? "", ownership: s.ownership ?? "", levels: s.levels });
const fixOf = (d: Draft): SchoolFix => ({ name: d.name, district: d.district, town: d.town.trim() || null, ownership: d.ownership, levels: d.levels });
const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// School directory, staff view. Figures and charts on top (click a region bar to filter), a one-line filter bar, and a dense table you can sort and page.
// Schools that users add wait under "Waiting": review, correct the spelling, then approve, merge into a listed school, or reject with a reason.
export default function SchoolDirectoryPage() {
  const [tab, setTab] = useState<Tab>("approved");
  const [query, setQuery] = useState(""), [search, setSearch] = useState("");
  const [region, setRegion] = useState(""), [district, setDistrict] = useState("");
  const [ownership, setOwnership] = useState<"" | Ownership | "unset">(""), [level, setLevel] = useState<"" | SchoolLevel>("");
  const [sort, setSort] = useState<AdminSort>("recent"), [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0), [size, setSize] = useState(50);
  const [stats, setStats] = useState<SchoolStats | null>(null), [data, setData] = useState<AdminSchoolList | null>(null);
  const [open, setOpen] = useState(""), [draft, setDraft] = useState<Draft | null>(null), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState(""), [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => { const t = setTimeout(() => { setSearch(query); setPage(0); }, 300); return () => clearTimeout(t); }, [query]);
  useEffect(() => { adminSchoolStats(region).then(setStats).catch((e) => setError(e.message)); }, [region, tick]);

  const filter: AdminListFilter = useMemo(() => ({ query: search, region, district, ownership, level, sort, dir }), [search, region, district, ownership, level, sort, dir]);
  useEffect(() => {
    if (tab === "import") return;
    const mine = ++seq.current;
    setData(null);
    adminListSchools(tab, filter, size, page * size).then((d) => { if (mine === seq.current) setData(d); }).catch((e) => { if (mine === seq.current) { setError(e.message); setData({ total: 0, rows: [], counts: {} }); } });
  }, [tab, filter, page, size, tick]);

  const reload = () => setTick((n) => n + 1);
  const counts: Partial<Record<DirectoryStatus, number>> = stats ? { approved: stats.totals.approved, pending: stats.totals.pending, rejected: stats.totals.rejected, merged: stats.totals.merged } : {};
  const filtered = !!(search || region || district || ownership || level);
  const clear = () => { setQuery(""); setSearch(""); setRegion(""); setDistrict(""); setOwnership(""); setLevel(""); setPage(0); };
  const sortBy = (k: AdminSort) => { if (sort === k) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(k); setDir(k === "linked" || k === "recent" ? "desc" : "asc"); } setPage(0); };
  const pickRegion = (r: string) => { setRegion(region === r ? "" : r); setDistrict(""); setPage(0); setTab(tab === "import" ? "approved" : tab); };

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true); setError(""); setDone("");
    try { await action(); setDone(label); setOpen(""); reload(); } catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  async function exportCsv() {
    if (tab === "import") return;
    setBusy(true); setError("");
    try {
      const out: AdminSchool[] = [];
      for (let off = 0; off < 10000; off += 200) { const d = await adminListSchools(tab, filter, 200, off); out.push(...d.rows); if (out.length >= d.total || !d.rows.length) break; }
      const head = ["school_name", "ownership", "region", "district", "town", "levels", "status", "people_linked", "source"];
      const body = out.map((s) => [s.name, s.ownership ?? "", s.region, s.district, s.town ?? "", s.levels.join("|"), s.status, s.users_linked, s.source ?? ""].map(csvCell).join(","));
      const url = URL.createObjectURL(new Blob([[head.join(","), ...body].join("\r\n")], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url; a.download = `schools_${tab}_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
      setDone(`Exported ${num(out.length)} schools.`);
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  function openSchool(s: AdminSchool) { setOpen(open === s.id ? "" : s.id); setDraft(draftOf(s)); setNote(""); setError(""); setDone(""); }

  const t = stats?.totals;
  const regionRows = (stats?.by_region ?? []).map((r) => ({ key: r.region, label: r.region, segments: [{ value: r.private, color: SERIES.a, name: "Private" }, { value: r.public, color: SERIES.b, name: "Public" }, { value: r.unset, color: SERIES.none, name: "Not set" }] }));
  const levelRows = stats ? LEVELS.map((l) => ({ key: l, label: LEVEL_LABEL[l], segments: [{ value: stats.by_level[l], color: SERIES.a, name: LEVEL_LABEL[l] }] })) : [];
  const sortTh = (k: AdminSort, label: string, className?: string) => (
    <th key={k} className={className} aria-sort={sort === k ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="dx-sort" onClick={() => sortBy(k)}>{label}{sort === k ? (dir === "asc" ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />) : <ChevronsUpDown size={12} aria-hidden="true" style={{ opacity: .4 }} />}</button>
    </th>
  );

  return (
    <div className="dx-page">
      <div className="dx-head">
        <div><h1>School directory</h1><p>The list students and teachers pick their school from. Approve schools people add, merge look-alikes, and keep names accurate.</p></div>
        <div className="dx-actions">
          <button className="dx-btn" disabled={busy || tab === "import"} onClick={() => void exportCsv()}>Export CSV</button>
          <button className="dx-btn primary" onClick={() => { setTab("import"); setOpen(""); }}>Import list</button>
        </div>
      </div>

      <div className="dx-kpis">
        <Kpi label="Schools listed" value={t?.approved ?? "—"} hint={t ? `${num(t.regions)} regions · ${num(t.districts)} districts` : undefined} />
        <Kpi label="Private" value={t?.private ?? "—"} hint={t && t.approved ? `${Math.round((t.private / t.approved) * 100)}% of listed` : undefined} />
        <Kpi label="Public" value={t?.public ?? "—"} hint={t && t.approved ? `${Math.round((t.public / t.approved) * 100)}% of listed` : undefined} />
        <Kpi label="Waiting for review" value={t?.pending ?? "—"} hint="Added by users" tone={t && t.pending > 0 ? "warn" : "default"} />
        <Kpi label="People linked" value={t?.people_linked ?? "—"} hint="Students and teachers" />
        <Kpi label="Need a look" value={t?.needs_review ?? "—"} hint="District not in the list yet" tone={t && t.needs_review > 0 ? "warn" : "default"} />
      </div>

      <div className="dx-grid">
        <Panel title="Schools by region" subtitle={region ? `Filtered to ${region}. Click the bar again to clear.` : "Click a region to filter the table."}
          action={<ul className="dx-legend" aria-label="Legend" style={{ margin: 0 }}><li><span className="dx-swatch" style={{ background: SERIES.a }} />Private</li><li><span className="dx-swatch" style={{ background: SERIES.b }} />Public</li><li><span className="dx-swatch" style={{ background: SERIES.none }} />Not set</li></ul>}>
          {stats ? <RankedBars rows={regionRows} active={region} onPick={pickRegion} limit={8} /> : <div className="dx-muted dx-note">Loading…</div>}
        </Panel>
        <div className="dx-stack">
          <Panel title="Public and private" subtitle="Listed schools">{t ? <SplitBar parts={[{ name: "Private", value: t.private, color: SERIES.a }, { name: "Public", value: t.public, color: SERIES.b }, { name: "Not set", value: t.unset, color: SERIES.none }]} /> : <div className="dx-muted dx-note">Loading…</div>}</Panel>
          <Panel title="By level" subtitle="A school can offer more than one">{stats ? <RankedBars rows={levelRows} /> : <div className="dx-muted dx-note">Loading…</div>}</Panel>
        </div>
        <Panel title="Activity, last 12 weeks" subtitle="Schools added by users and decided by staff">
          {stats ? <TrendCurve data={stats.weekly} series={[{ key: "added", name: "Added by users", color: SERIES.a }, { key: "decided", name: "Decided by staff", color: SERIES.b }]} /> : <div className="dx-muted dx-note">Loading…</div>}
        </Panel>
      </div>

      {error && <div className="dx-alert error" role="alert">{error}</div>}
      {done && <div className="dx-alert ok" role="status">{done}</div>}

      <div className="dx-toolbar">
        <Segmented label="Status" value={tab} onChange={(v) => { setTab(v); setPage(0); setOpen(""); setDone(""); setError(""); }}
          options={[{ value: "approved", label: "Approved", count: counts.approved }, { value: "pending", label: "Waiting", count: counts.pending }, { value: "rejected", label: "Rejected", count: counts.rejected }, { value: "merged", label: "Merged", count: counts.merged }, { value: "import", label: "Import" }]} />
        {tab !== "import" && <>
          <select className="dx-select" aria-label="Region" value={region} onChange={(e) => { setRegion(e.target.value); setDistrict(""); setPage(0); }}>
            <option value="">All regions</option>{(stats?.by_region ?? []).map((r) => <option key={r.region} value={r.region}>{r.region}</option>)}
          </select>
          <select className="dx-select" aria-label="District" value={district} disabled={!region} onChange={(e) => { setDistrict(e.target.value); setPage(0); }}>
            <option value="">{region ? "All districts" : "Pick a region first"}</option>{(stats?.districts ?? []).map((d) => <option key={d.district} value={d.district}>{d.district} ({num(d.schools)})</option>)}
          </select>
          <select className="dx-select" aria-label="Public or private" value={ownership} onChange={(e) => { setOwnership(e.target.value as typeof ownership); setPage(0); }}>
            <option value="">Public and private</option><option value="private">Private</option><option value="public">Public</option><option value="unset">Not set</option>
          </select>
          <select className="dx-select" aria-label="Level" value={level} onChange={(e) => { setLevel(e.target.value as typeof level); setPage(0); }}>
            <option value="">All levels</option>{LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
          </select>
          <input className="dx-input" type="search" placeholder="Search school, district or town" aria-label="Search schools" value={query} onChange={(e) => setQuery(e.target.value)} />
          {filtered && <button className="dx-link" type="button" onClick={clear}>Clear filters</button>}
        </>}
      </div>

      {tab === "import" ? <ImportPanel onLoaded={() => { setTab("approved"); setPage(0); reload(); }} /> : (
        <>
          <div className="dx-table-wrap">
            <table className="dx-table">
              <thead><tr>
                {sortTh("name", "School")}<th>Type</th><th>Levels</th>{sortTh("region", "Region")}{sortTh("district", "District")}
                {sortTh("linked", "People", "num")}{sortTh("recent", tab === "pending" ? "Added" : "Updated")}<th aria-label="Actions" />
              </tr></thead>
              <tbody>
                {data === null ? <tr><td colSpan={8} className="dx-muted">Loading…</td></tr> : !data.rows.length ? <tr><td colSpan={8} className="dx-muted">{tab === "pending" && !filtered ? "No schools are waiting." : "No schools match."}</td></tr> :
                  data.rows.map((s) => <SchoolRows key={s.id} s={s} tab={tab} open={open === s.id} draft={draft} busy={busy} note={note} onNote={setNote} onDraft={setDraft} onOpen={() => openSchool(s)} run={run} />)}
              </tbody>
            </table>
          </div>
          <div className="dx-pager">
            <span>{data && data.total > 0 ? `${num(page * size + 1)}–${num(Math.min((page + 1) * size, data.total))} of ${num(data.total)}` : "0 schools"}</span>
            <div className="dx-actions">
              <span className="dx-muted">Rows</span><select className="dx-select" aria-label="Rows per page" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>{SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select>
              <button className="dx-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <button className="dx-btn" disabled={!data || (page + 1) * size >= data.total} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        </>)}
    </div>
  );
}

function SchoolRows({ s, tab, open, draft, busy, note, onNote, onDraft, onOpen, run }: {
  s: AdminSchool; tab: Tab; open: boolean; draft: Draft | null; busy: boolean; note: string; onNote: (v: string) => void; onDraft: (d: Draft) => void; onOpen: () => void;
  run: (label: string, action: () => Promise<unknown>) => Promise<void>;
}) {
  const canEdit = s.status === "pending" || s.status === "approved";
  return (
    <>
      <tr>
        <td className="name">{s.name}{s.needs_review && <> <span className="dx-pill warn" title="The district is not in the list yet">check district</span></>}</td>
        <td>{s.ownership ? <span className={`dx-pill ${s.ownership}`}>{OWNERSHIP_LABEL[s.ownership]}</span> : <span className="dx-muted">—</span>}</td>
        <td>{s.levels.map((l) => <span key={l} className="dx-pill" style={{ marginInlineEnd: 4 }}>{LEVEL_LABEL[l]}</span>)}</td>
        <td>{s.region}</td>
        <td title={s.town ? `Town: ${s.town}` : undefined}>{s.district}</td>
        <td className="num">{num(s.users_linked)}</td>
        <td className="dx-muted" title={s.source ?? undefined}>{formatDate(s.status === "pending" ? s.submitted_at : (s.decided_at ?? s.submitted_at))}{s.status === "pending" && s.submitter_name ? ` · ${s.submitter_name}` : ""}</td>
        <td>{canEdit && <button className="dx-btn sm" aria-expanded={open} onClick={onOpen}>{open ? "Close" : s.status === "pending" ? "Review" : "Edit"}</button>}</td>
      </tr>
      {!canEdit && s.decision_note && <tr className="dx-detail"><td colSpan={8} className="dx-muted">Note: {s.decision_note}</td></tr>}
      {open && draft && (
        <tr className="dx-detail"><td colSpan={8}>
          {s.status === "pending" && <p style={{ margin: "0 0 8px", fontSize: 12.5 }}>
            Added {formatDate(s.submitted_at)} by {s.submitter_name ?? "a user"}{s.submitter_email ? <> (<a href={`mailto:${s.submitter_email}`}>{s.submitter_email}</a>)</> : null}. {num(s.users_linked)} {s.users_linked === 1 ? "person uses" : "people use"} it.</p>}
          {s.status === "pending" && s.similar.length > 0 && <div style={{ margin: "0 0 8px", fontSize: 12.5 }}>
            <strong>Already listed, looks similar</strong> <span className="dx-muted">(write a note, then merge)</span>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{s.similar.map((m) => <li key={m.id} style={{ marginBottom: 4 }}>{m.name} · {m.district}{m.town ? ` · ${m.town}` : ""}{m.ownership ? ` · ${OWNERSHIP_LABEL[m.ownership]}` : ""}{" "}
              <button className="dx-btn sm" disabled={busy || note.trim().length < 5} onClick={() => void run(`${s.name} merged into ${m.name}.`, () => adminDecideSchool(s.id, "merge", note.trim(), m.id))}>Merge into this</button></li>)}</ul></div>}
          <div className="dx-form">
            <label>School name<input className="dx-input" value={draft.name} onChange={(e) => onDraft({ ...draft, name: e.target.value })} /></label>
            <label>District<input className="dx-input" value={draft.district} onChange={(e) => onDraft({ ...draft, district: e.target.value })} /></label>
            <label>Town (optional)<input className="dx-input" value={draft.town} onChange={(e) => onDraft({ ...draft, town: e.target.value })} /></label>
            <label>Public or private<select className="dx-select" value={draft.ownership} onChange={(e) => onDraft({ ...draft, ownership: e.target.value as Ownership | "" })}><option value="">Not set</option><option value="public">Public</option><option value="private">Private</option></select></label>
            <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 12.5, paddingBottom: 4 }} role="group" aria-label="Levels">
              {LEVELS.map((l) => <label key={l} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12.5, color: "var(--ink-secondary)" }}><input type="checkbox" checked={draft.levels.includes(l)} onChange={() => onDraft({ ...draft, levels: draft.levels.includes(l) ? draft.levels.filter((x) => x !== l) : [...draft.levels, l] })} />{LEVEL_LABEL[l]}</label>)}
            </div>
            {tab === "pending" && <label>Note (needed to reject or merge)<input className="dx-input" value={note} maxLength={500} onChange={(e) => onNote(e.target.value)} placeholder="For example: checked with the district office" /></label>}
          </div>
          <div className="dx-actions" style={{ marginTop: 8 }}>
            {s.status === "approved"
              ? <button className="dx-btn primary" disabled={busy || !draft.levels.length} onClick={() => void run(`${draft.name} saved.`, () => adminUpdateSchool(s.id, fixOf(draft)))}>Save changes</button>
              : <>
                <button className="dx-btn primary" disabled={busy || !draft.levels.length} onClick={() => void run(`${draft.name} approved.`, () => adminDecideSchool(s.id, "approve", note.trim(), null, fixOf(draft)))}>Approve</button>
                <button className="dx-btn danger" disabled={busy || note.trim().length < 5} onClick={() => void run(`${s.name} rejected. The people who used it were asked to pick again.`, () => adminDecideSchool(s.id, "reject", note.trim()))}>Reject</button>
              </>}
          </div>
        </td></tr>
      )}
    </>
  );
}

// CSV import. The file is read in the browser and sent in chunks of 400 rows. A school already listed is not duplicated (it only gets its blanks filled), so loading the same file twice is safe.
function ImportPanel({ onLoaded }: { onLoaded: () => void }) {
  const [parsed, setParsed] = useState<ParsedSchools | null>(null), [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [error, setError] = useState("");
  const [result, setResult] = useState<{ added: number; updated: number; skipped: number; problems: { row: number; name: string; why: string }[] } | null>(null);
  const stop = useRef(false);

  const choose = useCallback(async (file?: File) => {
    setResult(null); setError(""); setParsed(null); setProgress(0);
    if (!file) return;
    setFileName(file.name);
    try { setParsed(readSchoolCsv(await file.text())); } catch { setError("That file could not be read as a CSV."); }
  }, []);
  async function start() {
    if (!parsed?.rows.length) return;
    setBusy(true); setError(""); stop.current = false;
    const total = { added: 0, updated: 0, skipped: 0, problems: [] as { row: number; name: string; why: string }[] };
    const chunks = chunkRows(parsed.rows, 400);
    try {
      for (let i = 0; i < chunks.length && !stop.current; i++) {
        const r = await adminImportSchools(chunks[i], `import:${fileName}`.slice(0, 120));
        total.added += r.added; total.updated += r.updated; total.skipped += r.skipped; total.problems.push(...r.problems.map((p) => ({ ...p, row: p.row + i * 400 })));
        setProgress(Math.round(((i + 1) / chunks.length) * 100)); setResult({ ...total, problems: total.problems.slice(0, 20) });
      }
    } catch (e: any) { setError(`${e.message} The rows loaded so far are kept; you can run the same file again.`); }
    setBusy(false);
  }

  return (
    <Panel title="Import a school list" subtitle="CSV in the QuizBox school format. Loaded schools are approved at once. Loading the same file twice is safe.">
      <p className="dx-muted dx-note" style={{ marginTop: 0 }}>Columns: school_name, ownership, region, district, levels (for example Primary|JHS), and optional town, gender, boarding, category, programs, school_code. Rows with no Primary, JHS or SHS level are skipped.</p>
      <div className="dx-actions" style={{ alignItems: "center" }}>
        <input type="file" accept=".csv,text/csv" disabled={busy} aria-label="CSV file" onChange={(e) => void choose(e.target.files?.[0])} />
        <button className="dx-btn primary" disabled={busy || !parsed?.rows.length} onClick={() => void start()}>{busy ? `Loading… ${progress}%` : "Load schools"}</button>
        {busy && <button className="dx-btn" onClick={() => { stop.current = true; }}>Stop after this chunk</button>}
      </div>
      {error && <div role="alert" className="dx-alert error" style={{ marginTop: 8 }}>{error}</div>}
      {parsed && parsed.missingColumns.length > 0 && <div role="alert" className="dx-alert error" style={{ marginTop: 8 }}>The file is missing these columns: {parsed.missingColumns.join(", ")}.</div>}
      {parsed && !parsed.missingColumns.length && <p className="dx-note" style={{ marginTop: 8 }}><b>{num(parsed.rows.length)}</b> schools ready to load from {num(parsed.total)} rows.
        {parsed.dropped.noLevel > 0 && <> {num(parsed.dropped.noLevel)} skipped (no Primary, JHS or SHS level).</>}{parsed.dropped.missing > 0 && <> {num(parsed.dropped.missing)} skipped (no name, region or district).</>}</p>}
      {result && <div role="status" className="dx-note" style={{ marginTop: 8 }}><b>{num(result.added)}</b> added · <b>{num(result.updated)}</b> already listed (blanks filled) · <b>{num(result.skipped)}</b> skipped.
        {result.problems.length > 0 && <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{result.problems.map((p, i) => <li key={i}>Row {p.row}: {p.name || "(no name)"}. {p.why}</li>)}</ul>}
        {!busy && progress === 100 && <div style={{ marginTop: 8 }}><button className="dx-btn" onClick={onLoaded}>View approved schools</button></div>}</div>}
    </Panel>
  );
}
