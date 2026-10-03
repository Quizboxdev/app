"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSources, importPackage, previewPackage, sourceRegistry, type PreviewGroup, type RegistryRow, type SourceMarket } from "@/lib/api/sources";
import { parsePackage, type ParsedPackage } from "@/lib/content/sources/package";

const STATUSES = ["IMPORTED", "FETCHED", "EXTRACTED", "MAPPED", "NEEDS_REVIEW", "APPROVED", "ACTIVE", "SUPERSEDED", "REJECTED", "DIRECT_PDF_PENDING"];
const ALL = "__ALL__";
type Readiness = { market: string; ready: boolean; blockers: string[]; sources?: { active: number; pending: number; registered: number; by_curriculum: Array<{ curriculum: string; active: number; pending: number }> } };

// Super Admin: Market Setup -> Curriculum Sources. Target country first, then the source package, then a server-validated
// preview. Nothing is fetched, approved or activated without an explicit action; no questions are generated here.
export default function CurriculumSourcesPage() {
  const [markets, setMarkets] = useState<SourceMarket[]>([]), [target, setTarget] = useState(""), [pkg, setPkg] = useState<ParsedPackage | null>(null);
  const [preview, setPreview] = useState<PreviewGroup[] | null>(null), [mapping, setMapping] = useState<Record<string, Record<string, string>>>({}), [imported, setImported] = useState<any>(null);
  const [rows, setRows] = useState<RegistryRow[]>([]), [byStatus, setByStatus] = useState<Record<string, number>>({}), [packages, setPackages] = useState<any[]>([]), [readiness, setReadiness] = useState<Readiness[]>([]);
  const [filters, setFilters] = useState({ country_id: "", market_id: "", authority_id: "", curriculum_id: "", level: "", subject: "", status: "" });
  const [notes, setNotes] = useState<Record<string, string>>({}), [rights, setRights] = useState<Record<string, boolean>>({}), [urls, setUrls] = useState<Record<string, string>>({}), [domains, setDomains] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const act = useCallback(async (work: () => Promise<unknown>, message?: string) => { setBusy(true); setError(""); setNotice(""); try { await work(); if (message) setNotice(message); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }, []);
  const loadRegistry = useCallback(async () => {
    const list = await sourceRegistry<{ rows: RegistryRow[]; by_status: Record<string, number>; packages: any[] }>("list", filters);
    setRows(list.rows); setByStatus(list.by_status); setPackages(list.packages);
  }, [filters]);
  const loadReadiness = useCallback(async (list: SourceMarket[]) => {
    setReadiness(await Promise.all(list.map(async (m) => ({ market: m.market, ...(await sourceRegistry<Omit<Readiness, "market">>("readiness", { market_id: m.market_id })) }))));
  }, []);
  useEffect(() => { void act(async () => { const list = await sourceRegistry<SourceMarket[]>("options"); setMarkets(list); await loadReadiness(list); }); }, [act, loadReadiness]);
  useEffect(() => { void act(loadRegistry); }, [act, loadRegistry]);

  const curricula = useMemo(() => markets.flatMap((m) => m.curricula.map((c) => ({ ...c, market_id: m.market_id, market: m.market }))), [markets]);
  const targetMarket = target === ALL ? null : target || null;
  async function choosePackage(file: File | undefined) {
    setPkg(null); setPreview(null); setImported(null); if (!file) return;
    await act(async () => setPkg(await parsePackage(file.name, await file.arrayBuffer())));
  }
  // Every level must be mapped explicitly: a level is never assumed to belong to a market's only curriculum
  // (e.g. senior-secondary sources must not be attributed to a junior-secondary curriculum). Unmapped levels are skipped.
  const validate = (map = mapping) => act(async () => { if (!pkg) return; setPreview((await previewPackage(pkg, targetMarket, map)).groups); });
  const confirmImport = () => act(async () => { if (!pkg) return; const result = await importPackage(pkg, targetMarket, mapping); setImported(result); setPreview(null); await loadRegistry(); await loadReadiness(markets); }, "Package registered. Nothing has been fetched or approved yet.");
  const rowAction = (action: string, row: RegistryRow, data: Record<string, unknown> = {}) => act(async () => { await sourceRegistry(action, { id: row.id, ...data }); await loadRegistry(); await loadReadiness(markets); }, `${row.title}: ${action.replace("_", " ")} recorded.`);
  const runFetch = (market?: string) => act(async () => { const result = await fetchSources({ market_id: market || filters.market_id || undefined, limit: 3 }); await loadRegistry();
    setNotice(`Fetched ${result.outcomes.filter((o) => o.status === "NEEDS_REVIEW").length} of ${result.claimed}: ${result.outcomes.map((o) => `${o.title} ${o.error ?? o.status}`).join("; ") || "nothing eligible"}.`); });

  return <>
    <div className="qb-page-head"><div><h1>Curriculum sources</h1><p>Import official curriculum source packs per country, review every source, then activate it for that market only.</p></div></div>
    {error && <p className="qb-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}

    <section className="qb-card"><h2>Bulk import</h2>
      <div className="qb-content-filters">
        <label>Step 1 · Target country<select value={target} onChange={(e) => { setTarget(e.target.value); setPreview(null); setImported(null); }}>
          <option value="">Select target country</option>{markets.map((m) => <option key={m.market_id} value={m.market_id}>{m.country} — {m.market}{m.is_test ? " (test)" : ""}</option>)}
          <option value={ALL}>Each configured country in a multi-country pack</option></select></label>
        <label>Step 2 · Source package (ZIP, JSON or CSV)<input type="file" accept=".zip,.json,.csv" disabled={!target} onChange={(e) => void choosePackage(e.target.files?.[0])}/></label>
      </div>
      {pkg && <p className="qb-muted">{pkg.name} · {pkg.package_type.replaceAll("_", " ")} · {pkg.groups.map((g) => `${g.country} (${g.rows.length})`).join(", ")}{pkg.attachments.length ? ` · ${pkg.attachments.length} bundled file(s) recorded, not imported` : ""}</p>}
      {pkg && <button className="qb-btn" disabled={busy || !target} onClick={() => validate()}>Step 3 · Validate package</button>}
      {preview && <>{preview.map((g) => <div key={g.country} className="qb-card">
        <h3>{g.country} {g.market ? `→ ${g.market}` : "→ not imported"}</h3>
        {g.warnings.length > 0 && <p className="qb-error">{g.warnings.map((w) => w.replaceAll("_", " ").toLowerCase()).join("; ")}</p>}
        {g.market_id && g.levels.map((level) => <label key={level}>Curriculum for “{level}”<select value={mapping[g.market_id!]?.[level] ?? ""} onChange={(e) => { const next = { ...mapping, [g.market_id!]: { ...(mapping[g.market_id!] ?? {}), [level]: e.target.value } }; setMapping(next); void validate(next); }}>
          <option value="">Not mapped — skip these sources</option>{g.curricula.map((c) => <option key={c.id} value={c.id}>{c.code} ({c.authority})</option>)}</select></label>)}
        <dl className="qb-stat-list">{Object.entries(g.totals).map(([k, v]) => <div key={k}><dt>{k.replaceAll("_", " ")}</dt><dd>{v}</dd></div>)}</dl>
        <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Authority</th><th>Curriculum</th><th>Level</th><th>Subject</th><th>Sources</th><th>Verified PDFs</th><th>Index-only</th><th>Pending</th><th>Duplicates</th><th>Warnings</th></tr></thead>
          <tbody>{(g.summary ?? []).map((s, i) => <tr key={i}><td>{s.authority ?? "-"}</td><td>{s.curriculum ?? "-"}</td><td>{s.level}</td><td>{s.subject}</td><td>{s.sources}</td><td>{s.verified_pdfs}</td><td>{s.index_only}</td><td>{s.pending}</td><td>{s.duplicates}</td><td>{s.warnings.join(", ").replaceAll("_", " ").toLowerCase() || "-"}</td></tr>)}</tbody></table></div>
      </div>)}
        <button className="qb-btn" disabled={busy || !preview.some((g) => g.market_id && g.totals.importable > 0)} onClick={() => window.confirm("Register these sources? Fetching, review and activation remain separate steps.") && confirmImport()}>Confirm import</button></>}
      {imported && <ul>{imported.jobs.map((j: any, i: number) => <li key={i}>{j.country}: {j.status === "IMPORTED" ? `${j.imported} registered, ${j.skipped} skipped (${j.market})` : `not imported (${(j.warnings ?? []).join(", ")})`}</li>)}</ul>}
    </section>

    <section className="qb-card"><h2>Market readiness</h2>
      <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Market</th><th>Curriculum sources</th><th>Per curriculum</th><th>Blockers</th></tr></thead>
        <tbody>{readiness.map((r) => <tr key={r.market}><td>{r.market}</td><td>{r.sources ? `${r.sources.active} active / ${r.sources.pending} pending` : "-"}</td>
          <td>{r.sources?.by_curriculum.map((c) => `${c.curriculum}: ${c.active} active, ${c.pending} pending`).join("; ") || "-"}</td><td>{r.ready ? "Ready" : r.blockers.map((b) => b.replaceAll("_", " ").toLowerCase()).join(", ")}</td></tr>)}</tbody></table></div>
    </section>

    <section className="qb-card"><h2>Official publishing domains</h2>
      <p className="qb-muted">Sources are fetched only from these hosts. Configure each authority from its own official site.</p>
      <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Market</th><th>Authority</th><th>Domains</th><th></th></tr></thead>
        <tbody>{curricula.filter((c, i, a) => a.findIndex((x) => x.authority_id === c.authority_id) === i).map((c) => <tr key={c.authority_id}><td>{c.market}</td><td>{c.authority}</td>
          <td><input aria-label={`Official domains for ${c.authority}`} value={domains[c.authority_id] ?? c.official_domains.join(", ")} onChange={(e) => setDomains({ ...domains, [c.authority_id]: e.target.value })}/></td>
          <td><button className="qb-btn secondary" disabled={busy || domains[c.authority_id] === undefined} onClick={() => act(async () => { await sourceRegistry("set_domains", { authority_id: c.authority_id, domains: domains[c.authority_id].split(/[\s,]+/).filter(Boolean) }); setMarkets(await sourceRegistry<SourceMarket[]>("options")); }, "Official domains saved.")}>Save</button></td></tr>)}</tbody></table></div>
    </section>

    <section className="qb-card"><h2>Source registry</h2>
      <div className="qb-content-filters">
        <label>Country<select value={filters.country_id} onChange={(e) => setFilters({ ...filters, country_id: e.target.value })}><option value="">All</option>{[...new Map(markets.map((m) => [m.country_id, m.country])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Market<select value={filters.market_id} onChange={(e) => setFilters({ ...filters, market_id: e.target.value })}><option value="">All</option>{markets.map((m) => <option key={m.market_id} value={m.market_id}>{m.market}</option>)}</select></label>
        <label>Authority<select value={filters.authority_id} onChange={(e) => setFilters({ ...filters, authority_id: e.target.value })}><option value="">All</option>{curricula.filter((c, i, a) => a.findIndex((x) => x.authority_id === c.authority_id) === i).map((c) => <option key={c.authority_id} value={c.authority_id}>{c.authority} ({c.market})</option>)}</select></label>
        <label>Curriculum<select value={filters.curriculum_id} onChange={(e) => setFilters({ ...filters, curriculum_id: e.target.value })}><option value="">All</option>{curricula.map((c) => <option key={c.id} value={c.id}>{c.code} ({c.market})</option>)}</select></label>
        <label>Level<input value={filters.level} onChange={(e) => setFilters({ ...filters, level: e.target.value })}/></label>
        <label>Subject<input value={filters.subject} onChange={(e) => setFilters({ ...filters, subject: e.target.value })}/></label>
        <label>Status<select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">All</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
      </div>
      <p className="qb-muted">{STATUSES.filter((s) => byStatus[s]).map((s) => `${s.replaceAll("_", " ").toLowerCase()} ${byStatus[s]}`).join(" · ") || "No sources registered."}</p>
      <button className="qb-btn secondary" disabled={busy} onClick={() => runFetch()}>Fetch next verified PDFs{filters.market_id ? " for this market" : ""}</button>
      <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Source</th><th>Market</th><th>Curriculum</th><th>Level</th><th>Subject</th><th>Type</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}>
          <td><a href={r.canonical_url} target="_blank" rel="noreferrer noopener">{r.title}</a><div className="qb-small qb-muted">{r.package}{r.sha256 ? ` · sha256 ${r.sha256.slice(0, 12)}… · ${r.pages ?? "?"} pages` : ""}{r.last_error ? ` · ${r.last_error}` : ""}</div></td>
          <td>{r.market}<div className="qb-small qb-muted">{r.country}</div></td><td>{r.curriculum}<div className="qb-small qb-muted">{r.authority}</div></td><td>{r.education_level}</td><td>{r.subject_code}</td>
          <td>{r.source_type.replaceAll("_", " ").toLowerCase()}<div className="qb-small qb-muted">{r.verification_status.toLowerCase()}</div></td><td><span className="qb-pill">{r.status}</span></td>
          <td>{r.status === "NEEDS_REVIEW" && <div className="qb-content-filters">
              <label className="qb-small">Review note<input value={notes[r.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}/></label>
              <label className="qb-small"><input type="checkbox" checked={rights[r.id] ?? false} onChange={(e) => setRights({ ...rights, [r.id]: e.target.checked })}/>Official publication; QuizBox may use it as a curriculum source</label>
              <button className="qb-btn" disabled={busy} onClick={() => rowAction("review", r, { decision: "approve", note: notes[r.id] ?? "", rights_confirmed: rights[r.id] ?? false })}>Approve</button>
              <button className="qb-btn secondary" disabled={busy} onClick={() => rowAction("review", r, { decision: "reject", note: notes[r.id] ?? "" })}>Reject</button></div>}
            {r.status === "APPROVED" && <button className="qb-btn" disabled={busy} onClick={() => rowAction("activate", r)}>Activate</button>}
            {r.status === "DIRECT_PDF_PENDING" && <div className="qb-content-filters">
              <label className="qb-small">Direct official PDF URL<input value={urls[r.id] ?? ""} onChange={(e) => setUrls({ ...urls, [r.id]: e.target.value })}/></label>
              <label className="qb-small">Verification note<input value={notes[r.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}/></label>
              <button className="qb-btn secondary" disabled={busy} onClick={() => rowAction("set_direct_url", r, { url: urls[r.id] ?? "", note: notes[r.id] ?? "" })}>Confirm URL</button></div>}
          </td></tr>)}</tbody></table>
        {!rows.length && <p className="qb-muted">No sources match these filters.</p>}</div>
      {packages.length > 0 && <><h3>Packages</h3><ul>{packages.map((p) => <li key={p.id}>{p.name} · {p.type.replaceAll("_", " ").toLowerCase()} · {p.entries} entries · {p.jobs.map((j: any) => `${j.market}: ${j.imported} registered`).join("; ")}</li>)}</ul></>}
    </section>
  </>;
}
