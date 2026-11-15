"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  adminDecideSchool, adminImportSchools, adminListSchools, adminUpdateSchool, LEVEL_LABEL, OWNERSHIP_LABEL,
  type AdminSchool, type AdminSchoolList, type DirectoryStatus, type Ownership, type SchoolFix, type SchoolLevel,
} from "@/lib/api/schools";
import { chunkRows, readSchoolCsv, type ParsedSchools } from "@/lib/schools/csv";
import { formatDate } from "@/lib/format";

const TABS: [DirectoryStatus | "import", string][] = [["pending", "Waiting"], ["approved", "Approved"], ["rejected", "Rejected"], ["merged", "Merged"], ["import", "Import list"]];
const LEVELS: SchoolLevel[] = ["primary", "jhs", "shs"];
const PAGE = 50;

type Draft = { name: string; district: string; town: string; ownership: Ownership | ""; levels: SchoolLevel[] };
const draftOf = (s: AdminSchool): Draft => ({ name: s.name, district: s.district, town: s.town ?? "", ownership: s.ownership ?? "", levels: s.levels });
const fixOf = (d: Draft): SchoolFix => ({ name: d.name, district: d.district, town: d.town.trim() || null, ownership: d.ownership, levels: d.levels });

// Schools that users added wait here. Staff check each one, correct the spelling, then approve it, merge it into a school that is already listed, or reject it with a reason.
// Approved schools can be corrected later; everyone linked to a school sees the corrected name. The Import tab loads a CSV in the QuizBox school format (Content/Schools).
export default function SchoolDirectoryPage() {
  const [tab, setTab] = useState<DirectoryStatus | "import">("pending");
  const [query, setQuery] = useState(""), [page, setPage] = useState(0);
  const [data, setData] = useState<AdminSchoolList | null>(null);
  const [open, setOpen] = useState(""), [draft, setDraft] = useState<Draft | null>(null), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");

  const load = () => {
    if (tab === "import") return;
    setData(null);
    adminListSchools(tab, query, PAGE, page * PAGE).then(setData).catch((e) => { setError(e.message); setData({ total: 0, rows: [], counts: {} }); });
  };
  useEffect(load, [tab, page]);   // eslint-disable-line react-hooks/exhaustive-deps
  const counts = data?.counts ?? {};

  function openSchool(s: AdminSchool) { setOpen(open === s.id ? "" : s.id); setDraft(draftOf(s)); setNote(""); setError(""); setDone(""); }
  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true); setError(""); setDone("");
    try { await action(); setDone(label); setOpen(""); load(); } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  return (
    <>
      <div className="qb-page-head"><div><h1>School directory</h1><p>Schools that students and teachers pick from. Approve the ones people add, merge look-alikes so each school is listed once, and keep names accurate.</p></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {done && <div className="qb-card" role="status"><CheckCircle2 size={16} aria-hidden="true" /> {done}</div>}
      <section className="qb-card">
        <div className="qb-chip-row" role="group" aria-label="Show">
          {TABS.map(([v, l]) => <button key={v} type="button" className="qb-chip" aria-pressed={tab === v} onClick={() => { setTab(v); setPage(0); setOpen(""); setDone(""); setError(""); }}>{l}{v !== "import" && counts[v] !== undefined ? ` (${counts[v]})` : ""}</button>)}
        </div>
        {tab !== "import" && tab !== "pending" && <form style={{ marginTop: 10, display: "flex", gap: 8 }} onSubmit={(e) => { e.preventDefault(); setPage(0); load(); }}>
          <input className="qb-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by school or district" aria-label="Search schools" style={{ maxWidth: 360 }} />
          <button className="qb-btn" type="submit">Search</button></form>}
      </section>

      {tab === "import" ? <ImportPanel onLoaded={() => { setTab("approved"); setPage(0); }} /> : (
        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          {data === null ? <div className="qb-card qb-skeleton" style={{ minHeight: 100 }} aria-busy="true" /> : !data.rows.length ? <div className="qb-card qb-muted">{tab === "pending" ? "No schools are waiting." : "Nothing here."}</div> :
            data.rows.map((s) => (
              <article key={s.id} className="qb-card" aria-labelledby={`sch-${s.id}`}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline" }}>
                  <h2 id={`sch-${s.id}`} style={{ margin: 0, fontSize: 17 }}>{s.name}</h2>
                  <span className="qb-small qb-muted">{s.ownership ? OWNERSHIP_LABEL[s.ownership] : "Public / private not set"} · {s.levels.map((l) => LEVEL_LABEL[l]).join(", ")}</span>
                </div>
                <div className="qb-small qb-muted">{s.region} · {s.district}{s.town ? ` · ${s.town}` : ""}{s.needs_review ? " · District not in the list yet" : ""}</div>
                {s.status === "pending" && <div className="qb-small" style={{ marginTop: 6 }}>Added {formatDate(s.submitted_at)} by {s.submitter_name ?? "a user"}{s.submitter_email ? <> (<a href={`mailto:${s.submitter_email}`}>{s.submitter_email}</a>)</> : null} · {s.users_linked} {s.users_linked === 1 ? "person uses" : "people use"} it</div>}
                {s.status !== "pending" && s.decision_note && <p className="qb-small">{s.decision_note}</p>}
                {s.status === "approved" && <div className="qb-small qb-muted">{s.users_linked} {s.users_linked === 1 ? "person" : "people"} linked{s.source ? ` · source: ${s.source}` : ""}</div>}
                {(s.status === "pending" || s.status === "approved") && <button className="qb-btn" style={{ marginTop: 8 }} onClick={() => openSchool(s)}>{open === s.id ? "Close" : s.status === "pending" ? "Review" : "Edit"}</button>}

                {open === s.id && draft && <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  {s.status === "pending" && s.similar.length > 0 && <div className="qb-card" style={{ background: "var(--qb-surface-2, transparent)" }}>
                    <strong>Already listed, looks similar</strong>
                    <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{s.similar.map((m) => <li key={m.id} style={{ marginBottom: 6 }}>
                      {m.name} · {m.district}{m.town ? ` · ${m.town}` : ""}{m.ownership ? ` · ${OWNERSHIP_LABEL[m.ownership]}` : ""}{" "}
                      <button className="qb-btn" disabled={busy || note.trim().length < 5} title="Write a note below first" onClick={() => run(`${s.name} merged into ${m.name}. The people who used it now see ${m.name}.`, () => adminDecideSchool(s.id, "merge", note.trim(), m.id))}>Merge into this</button></li>)}</ul>
                    <span className="qb-small qb-muted">To merge, write a short note below first.</span>
                  </div>}
                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                    <label className="qb-field"><span>School name</span><input className="qb-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
                    <label className="qb-field"><span>District</span><input className="qb-input" value={draft.district} onChange={(e) => setDraft({ ...draft, district: e.target.value })} /></label>
                    <label className="qb-field"><span>Town (optional)</span><input className="qb-input" value={draft.town} onChange={(e) => setDraft({ ...draft, town: e.target.value })} /></label>
                    <label className="qb-field"><span>Public or private</span><select className="qb-input" value={draft.ownership} onChange={(e) => setDraft({ ...draft, ownership: e.target.value as Ownership | "" })}>
                      <option value="">Not set</option><option value="public">Public</option><option value="private">Private</option></select></label>
                  </div>
                  <fieldset className="qb-content-filters"><legend>Levels</legend>{LEVELS.map((l) => <label key={l}><input type="checkbox" checked={draft.levels.includes(l)} onChange={() => setDraft({ ...draft, levels: draft.levels.includes(l) ? draft.levels.filter((x) => x !== l) : [...draft.levels, l] })} />{LEVEL_LABEL[l]}</label>)}</fieldset>
                  {s.status === "approved" ? (
                    <div><button className="qb-btn" disabled={busy || !draft.levels.length} onClick={() => run(`${draft.name} saved.`, () => adminUpdateSchool(s.id, fixOf(draft)))}>Save changes</button></div>
                  ) : (<>
                    <label className="qb-field"><span>Note (needed to reject or merge)</span><input className="qb-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="For example: checked with the district office" /></label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="qb-btn" disabled={busy || !draft.levels.length} onClick={() => run(`${draft.name} approved.`, () => adminDecideSchool(s.id, "approve", note.trim(), null, fixOf(draft)))}>Approve</button>
                      <button className="qb-btn qb-btn-danger" disabled={busy || note.trim().length < 5} onClick={() => run(`${s.name} rejected. The people who used it were asked to pick again.`, () => adminDecideSchool(s.id, "reject", note.trim()))}>Reject</button>
                    </div>
                  </>)}
                </div>}
              </article>))}
          {data && data.total > PAGE && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="qb-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="qb-small qb-muted">{page * PAGE + 1}–{Math.min((page + 1) * PAGE, data.total)} of {data.total}</span>
            <button className="qb-btn" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage(page + 1)}>Next</button></div>}
        </div>)}
    </>
  );
}

// CSV import. The file is read in the browser and sent in chunks of 400 rows. A school already listed is not duplicated (it only gets its blanks filled), so loading the same file twice is safe.
function ImportPanel({ onLoaded }: { onLoaded: () => void }) {
  const [parsed, setParsed] = useState<ParsedSchools | null>(null), [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [error, setError] = useState("");
  const [result, setResult] = useState<{ added: number; updated: number; skipped: number; problems: { row: number; name: string; why: string }[] } | null>(null);
  const stop = useRef(false);

  async function choose(file?: File) {
    setResult(null); setError(""); setParsed(null); setProgress(0);
    if (!file) return;
    setFileName(file.name);
    try { setParsed(readSchoolCsv(await file.text())); } catch { setError("That file could not be read as a CSV."); }
  }
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
    <section className="qb-card" style={{ marginTop: 16, display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 17 }}>Import a school list</h2>
      <p className="qb-small qb-muted" style={{ margin: 0 }}>Use a CSV in the QuizBox school format: school_name, ownership, region, district, levels (for example Primary|JHS), and optional town, gender, boarding, category, programs, school_code. Schools with no Primary, JHS or SHS level are skipped. Loaded schools are approved at once.</p>
      <label>File<input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => void choose(e.target.files?.[0])} /></label>
      {error && <div role="alert" className="qb-error">{error}</div>}
      {parsed && parsed.missingColumns.length > 0 && <div role="alert" className="qb-error">The file is missing these columns: {parsed.missingColumns.join(", ")}.</div>}
      {parsed && !parsed.missingColumns.length && <div className="qb-small">
        <strong>{parsed.rows.length.toLocaleString()}</strong> schools ready to load from {parsed.total.toLocaleString()} rows.
        {parsed.dropped.noLevel > 0 && <> {parsed.dropped.noLevel.toLocaleString()} skipped (no Primary, JHS or SHS level).</>}
        {parsed.dropped.missing > 0 && <> {parsed.dropped.missing.toLocaleString()} skipped (no name, region or district).</>}
      </div>}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="qb-btn" disabled={busy || !parsed?.rows.length} onClick={() => void start()}>{busy ? `Loading… ${progress}%` : "Load schools"}</button>
        {busy && <button className="qb-btn" onClick={() => { stop.current = true; }}>Stop after this chunk</button>}
      </div>
      {result && <div role="status" className="qb-small"><strong>{result.added.toLocaleString()}</strong> added · <strong>{result.updated.toLocaleString()}</strong> already listed (blanks filled) · <strong>{result.skipped.toLocaleString()}</strong> skipped.
        {result.problems.length > 0 && <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{result.problems.map((p, i) => <li key={i}>Row {p.row}: {p.name || "(no name)"}. {p.why}</li>)}</ul>}
        {!busy && progress === 100 && <div style={{ marginTop: 8 }}><button className="qb-btn" onClick={onLoaded}>View approved schools</button></div>}
      </div>}
    </section>
  );
}
