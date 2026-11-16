"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { adminRequests, CATEGORIES, deleteRequest, requestDetail, setRequest, staffReply, STATUS, type AdminRow, type RequestDetail, type Status } from "@/lib/api/support";
import { AttachPicker, StatusChip, Thread, when } from "@/components/support/parts";
import ExportLink from "@/components/admin/ExportLink";
import { Kpi, Panel as DxPanel, RankedBars, Segmented, SERIES, TrendCurve, num } from "@/components/admin/DataViz";
import { supportStats } from "@/lib/admin/support-stats";

// Support queue for owners, admins, super admins and support staff. Pick a request, read the conversation, answer the person, or leave an internal note only staff see. A public answer is emailed
// (a signed-in person is told there is a reply; a visitor gets the text). Resolved or closed requests can be deleted with their files, as the Privacy Notice's retention period requires.
type Tab = "" | "open" | "waiting_for_user" | "resolved" | "closed";

function Panel({ id, onChanged, onError }: { id: string; onChanged: () => void; onError: (m: string) => void }) {
  const [d, setD] = useState<RequestDetail | null>(null), [body, setBody] = useState(""), [internal, setInternal] = useState(false), [status, setStatus] = useState<Status | "">(""), [files, setFiles] = useState<File[]>([]), [busy, setBusy] = useState("");
  const load = useCallback(() => { requestDetail(id).then(setD).catch((e) => onError(e.message)); }, [id, onError]);
  useEffect(() => { setD(null); load(); }, [load]);
  const run = async (what: string, fn: () => Promise<void>) => { setBusy(what); onError(""); try { await fn(); } catch (e: any) { onError(e.message); } setBusy(""); };
  if (!d) return <div className="qb-card"><p className="qb-muted">Loading…</p></div>;
  const r = d.request;
  return (
    <div className="qb-card" style={{ display: "grid", gap: 12 }}>
      <div>
        <h2 style={{ margin: 0 }}>{r.subject}</h2>
        <p className="qb-muted qb-small" style={{ margin: "4px 0 0" }}>{r.reference} · {CATEGORIES[r.category]} · {r.requester_name} &lt;{r.requester_email}&gt; · {r.source === "contact_form" ? "visitor (contact form)" : "signed in"} · opened {when(r.created_at)}{r.context ? ` · from: ${r.context}` : ""}</p>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <label className="qb-field" style={{ margin: 0 }}>Status<select value={r.status} disabled={!!busy} onChange={(e) => void run("set", async () => { await setRequest(id, e.target.value as Status, r.priority, r.assigned_to); load(); onChanged(); })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="qb-field" style={{ margin: 0 }}>Priority<select value={r.priority} disabled={!!busy} onChange={(e) => void run("set", async () => { await setRequest(id, r.status, e.target.value, r.assigned_to); load(); onChanged(); })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
        {(r.status === "resolved" || r.status === "closed") && <button className="qb-btn ghost" disabled={!!busy} onClick={() => { if (window.confirm("Delete this request and its files for good? This cannot be undone.")) void run("delete", async () => { await deleteRequest(id); onChanged(); }); }}>Delete request and files</button>}
        {r.category === "payment" && <Link className="qb-btn qb-btn-secondary" href="/admin/refunds">Open Refunds</Link>}
      </div>
      <Thread messages={d.messages} looseFiles={d.loose_files} staffView onError={onError} />
      <form onSubmit={(e) => { e.preventDefault(); void run("reply", async () => { await staffReply(id, body.trim(), internal, status || null, files); setBody(""); setFiles([]); setStatus(""); load(); onChanged(); }); }} className="qb-form" style={{ display: "grid", gap: 8 }}>
        <label className="qb-field">{internal ? "Internal note (the person never sees this)" : "Your answer to the person"}<textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} required /></label>
        <AttachPicker files={files} onChange={setFiles} disabled={!!busy || internal} />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label><input type="checkbox" checked={internal} onChange={(e) => { setInternal(e.target.checked); if (e.target.checked) setFiles([]); }} /> Internal note only</label>
          {!internal && <label>Then set status to <select value={status} onChange={(e) => setStatus(e.target.value as Status | "")}><option value="">Waiting for the person</option><option value="resolved">Resolved</option><option value="open">Keep open</option><option value="closed">Closed</option></select></label>}
          <button className="qb-btn" disabled={!!busy || !body.trim()}>{busy === "reply" ? "Sending…" : internal ? "Save note" : "Send answer"}</button>
        </div>
      </form>
    </div>
  );
}

export default function AdminTicketsPage() {
  const [all, setAll] = useState<AdminRow[] | null>(null), [sel, setSel] = useState(""), [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("open"), [category, setCategory] = useState(""), [priority, setPriority] = useState(""), [search, setSearch] = useState("");
  const load = useCallback(() => { adminRequests(null).then((r) => { setAll(r); setSel((s) => (r.some((x) => x.id === s) ? s : "")); }).catch((e) => { setError(e.message); setAll([]); }); }, []);
  useEffect(() => { load(); }, [load]);
  const now = useMemo(() => new Date(), [all]);   // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => (all ? supportStats(all, now) : null), [all, now]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (all ?? []).filter((r) => (!tab || r.status === tab) && (!category || r.category === category) && (!priority || r.priority === priority)
      && (!q || `${r.reference} ${r.subject} ${r.requester} ${r.email}`.toLowerCase().includes(q)))
      .sort((a, b) => (tab === "open" ? a.created_at.localeCompare(b.created_at) : b.last_message_at.localeCompare(a.last_message_at)));
  }, [all, tab, category, priority, search]);
  const filtered = !!(category || priority || search);
  const catRows = (stats?.categories ?? []).map((c) => ({ key: c.category, label: (CATEGORIES as Record<string, string>)[c.category] ?? c.category, segments: [{ value: c.n, color: SERIES.a, name: "Requests" }] }));
  const change = stats ? (stats.thisWeek === stats.lastWeek ? "same as last week" : `${stats.thisWeek > stats.lastWeek ? "up" : "down"} from ${stats.lastWeek} last week`) : undefined;
  return (
    <div className="dx-page">
      <div className="dx-head">
        <div><h1>Support requests</h1><p>Answer people who asked for help in the app or through the contact form. Payment questions: use <Link className="qb-link" href="/admin/refunds">Refunds</Link>.</p></div>
        <div className="dx-actions"><ExportLink dataset="support_requests" /></div>
      </div>
      <div className="dx-kpis">
        <Kpi label="Open" value={stats?.open ?? "—"} tone={stats && stats.open > 0 ? "warn" : "default"} hint={stats && stats.oldestOpenDays !== null ? `oldest ${stats.oldestOpenDays} day${stats.oldestOpenDays === 1 ? "" : "s"}` : undefined} />
        <Kpi label="High priority open" value={stats?.highOpen ?? "—"} tone={stats && stats.highOpen > 0 ? "warn" : "default"} />
        <Kpi label="Waiting for the person" value={stats?.waiting ?? "—"} />
        <Kpi label="Resolved or closed" value={stats?.done ?? "—"} />
        <Kpi label="Opened this week" value={stats?.thisWeek ?? "—"} hint={change} />
        <Kpi label="In the queue" value={stats?.total ?? "—"} hint="latest 200 requests" />
      </div>
      <div className="dx-grid" style={{ gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)" }}>
        <DxPanel title="Requests opened per day" subtitle="Last 30 days">{stats ? <TrendCurve bucket="day" data={stats.daily.map((d) => ({ week: d.week, opened: d.opened }))} series={[{ key: "opened", name: "Opened", color: SERIES.a }]} height={170} /> : <p className="dx-muted dx-note">Loading…</p>}</DxPanel>
        <DxPanel title="What people ask about" subtitle="Click a topic to filter the list">{stats ? (catRows.length ? <RankedBars rows={catRows} active={category || undefined} unit="requests" limit={6} onPick={(k) => { setCategory(category === k ? "" : k); setTab(""); }} /> : <p className="dx-muted dx-note">No requests yet.</p>) : <p className="dx-muted dx-note">Loading…</p>}</DxPanel>
      </div>
      {error && <div className="dx-alert error" role="alert">{error}</div>}
      <div className="dx-toolbar">
        <Segmented<Tab> label="Status" value={tab} onChange={(v) => { setTab(v); setSel(""); }}
          options={[{ value: "open", label: "Open", count: stats?.open }, { value: "waiting_for_user", label: "Waiting for the person", count: stats?.waiting }, { value: "resolved", label: "Resolved" }, { value: "closed", label: "Closed" }, { value: "", label: "All", count: stats?.total }]} />
        <select className="dx-select" aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">Any priority</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select>
        <select className="dx-select" aria-label="Topic" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All topics</option>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input className="dx-input" type="search" placeholder="Search reference, subject or person" aria-label="Search requests" value={search} onChange={(e) => setSearch(e.target.value)} />
        {filtered && <button className="dx-link" type="button" onClick={() => { setCategory(""); setPriority(""); setSearch(""); }}>Clear filters</button>}
      </div>
      <div className="dx-table-wrap">
        <table className="dx-table">
          <thead><tr><th>Reference</th><th>About</th><th>From</th><th>Status</th><th>Priority</th><th>Last update</th><th aria-label="Open" /></tr></thead>
          <tbody>
            {all === null ? <tr><td colSpan={7} className="dx-muted">Loading…</td></tr> : !rows.length ? <tr><td colSpan={7} className="dx-muted">No requests here.</td></tr> : rows.map((r) => (
              <tr key={r.id} style={r.id === sel ? { outline: "2px solid var(--blue)", outlineOffset: -2 } : undefined}>
                <td className="dx-muted">{r.reference}</td>
                <td className="name">{r.subject}<div className="dx-muted" style={{ fontWeight: 400, fontSize: 12 }}>{(CATEGORIES as Record<string, string>)[r.category] ?? r.category} · {r.messages} message{r.messages === 1 ? "" : "s"}</div></td>
                <td>{r.requester}<div className="dx-muted" style={{ fontSize: 12 }}>{r.signed_in ? "signed in" : "visitor"}</div></td>
                <td><StatusChip status={r.status} /></td>
                <td><span className={`dx-pill${r.priority === "high" ? " warn" : ""}`}>{r.priority}</span></td>
                <td className="dx-muted">{when(r.last_message_at)}</td>
                <td><button className="dx-btn sm" onClick={() => setSel(r.id)}>Open</button></td>
              </tr>))}
          </tbody>
        </table>
      </div>
      <div className="dx-pager"><span>{num(rows.length)} of {num(all?.length ?? 0)} requests</span></div>
      {sel && <Panel key={sel} id={sel} onChanged={() => { load(); }} onError={setError} />}
    </div>
  );
}
