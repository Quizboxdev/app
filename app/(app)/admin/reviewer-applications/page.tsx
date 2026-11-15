"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { decideApplication, listApplications, type Application, type DomainGrant } from "@/lib/api/reviewer-applications";
import { getSmeContext, type SmeContext } from "@/lib/api/sme";
import { daysText, reviewerStats } from "@/lib/admin/reviewer-stats";
import { Kpi, Panel, RankedBars, Segmented, SERIES, SplitBar, TrendCurve, num } from "@/components/admin/DataViz";
import { formatDate } from "@/lib/format";

type Tab = "pending" | "verified" | "suspended" | "all";
type Pick = { subject: string; level: string; grades: string; approve: boolean; senior: boolean; on: boolean };
const STATUS: Record<string, { text: string; tone: string }> = { pending: { text: "Waiting", tone: "warn" }, verified: { text: "Approved", tone: "ok" }, suspended: { text: "Declined", tone: "bad" } };
const DAY = 86_400_000;

// Support staff and the owner vet reviewer applications here. Approve ticks the subjects the teacher may review (pre-filled from their request);
// only the owner can tick "may approve" or "senior". A decline needs a reason, which the teacher sees. Everything is enforced by the database.
// The figures are worked out here from the same list the database returns.
export default function ReviewerApplicationsPage() {
  const [all, setAll] = useState<Application[] | null>(null);
  const [tab, setTab] = useState<Tab>("pending"), [subject, setSubject] = useState(""), [search, setSearch] = useState("");
  const [open, setOpen] = useState(""), [picks, setPicks] = useState<Pick[]>([]), [note, setNote] = useState("");
  const [sme, setSme] = useState<SmeContext | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");

  const load = useCallback(() => { listApplications("all").then(setAll).catch((e) => { setError(e.message); setAll([]); }); }, []);
  useEffect(load, [load]);
  useEffect(() => { getSmeContext().then(setSme).catch(() => setSme(null)); }, []);
  const owner = !!sme?.super_admin;
  const now = useMemo(() => new Date(), [all]);   // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => (all ? reviewerStats(all, now) : null), [all, now]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (all ?? []).filter((a) => (tab === "all" || a.status === tab) && (!subject || a.requested.some((r) => r.subject_code === subject))
      && (!q || `${a.name} ${a.email} ${a.school ?? ""}`.toLowerCase().includes(q)))
      .sort((a, b) => (tab === "pending" ? a.applied_at.localeCompare(b.applied_at) : b.applied_at.localeCompare(a.applied_at)));
  }, [all, tab, subject, search]);
  const current = useMemo(() => all?.find((r) => r.user_id === open), [all, open]);
  const waitingDays = (a: Application) => Math.floor((now.getTime() - new Date(a.applied_at).getTime()) / DAY);

  function start(a: Application) {
    setOpen(a.user_id === open ? "" : a.user_id); setNote(""); setError(""); setDone("");
    const levels = (a.requested[0]?.education_levels ?? []).join(", ");
    setPicks(a.requested.map((r) => ({ subject: r.subject_code, level: (r.education_levels ?? [])[0] ?? "", grades: "", approve: false, senior: false, on: true })).map((p) => ({ ...p, level: p.level || levels.split(",")[0]?.trim() || "" })));
  }
  async function decide(a: Application, decision: "approve" | "decline") {
    setBusy(true); setError(""); setDone("");
    try {
      const domains: DomainGrant[] = decision === "approve" ? picks.filter((p) => p.on && p.subject.trim()).map((p) => ({ subject_code: p.subject.trim(), market_id: a.requested.find((r) => r.subject_code === p.subject)?.market_id ?? null,
        education_level: p.level.trim() || null, grade_codes: p.grades.split(",").map((g) => g.trim()).filter(Boolean), can_approve: p.approve, can_senior_review: p.senior })) : [];
      const r = await decideApplication(a.user_id, decision, note.trim(), domains);
      setDone(decision === "approve" ? `${a.name} approved with ${r.domains_granted} subject${r.domains_granted === 1 ? "" : "s"}. They have been notified.` : `${a.name}'s application declined. They have been notified.`);
      setOpen(""); load();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  const setPick = (i: number, patch: Partial<Pick>) => setPicks(picks.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const filtered = !!(subject || search);
  const subjectRows = (stats?.subjects ?? []).map((s) => ({ key: s.subject, label: s.subject, segments: [{ value: s.n, color: SERIES.a, name: "Requests" }] }));
  const change = stats ? (stats.thisWeek === stats.lastWeek ? "same as last week" : `${stats.thisWeek > stats.lastWeek ? "up" : "down"} from ${stats.lastWeek} last week`) : undefined;

  return (
    <div className="dx-page">
      <div className="dx-head">
        <div><h1>Reviewer applications</h1><p>Teachers who asked to review questions. Check their details, choose the subjects they may review, then approve or decline.</p></div>
        <div className="dx-actions"><button className="dx-btn" disabled={!all} aria-label="Refresh" onClick={() => { setAll(null); load(); }}><RefreshCw size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Refresh</button></div>
      </div>

      <div className="dx-kpis">
        <Kpi label="Waiting for a decision" value={stats?.waiting ?? "—"} tone={stats && stats.waiting > 0 ? "warn" : "default"} hint={stats && stats.oldestWaitingDays !== null ? `oldest ${daysText(stats.oldestWaitingDays)}` : undefined} />
        <Kpi label="Approved" value={stats?.approved ?? "—"} />
        <Kpi label="Declined" value={stats?.declined ?? "—"} />
        <Kpi label="Applications this week" value={stats?.thisWeek ?? "—"} hint={change} />
        <Kpi label="Typical time to decide" value={stats ? daysText(stats.medianDecisionDays) : "—"} hint="median" />
        <Kpi label="All applications" value={stats?.total ?? "—"} />
      </div>

      <div className="dx-grid">
        <Panel title="Applications per week" subtitle="Received and decided, last 12 weeks">
          {stats ? <TrendCurve data={stats.weekly} series={[{ key: "applied", name: "Received", color: SERIES.a }, { key: "decided", name: "Decided", color: SERIES.b }]} height={180} /> : <p className="dx-muted dx-note">Loading…</p>}
        </Panel>
        <Panel title="Subjects requested" subtitle="Click a subject to filter the list">
          {stats ? (subjectRows.length ? <RankedBars rows={subjectRows} active={subject || undefined} unit="requests" limit={7} onPick={(k) => { setSubject(subject === k ? "" : k); setTab("all"); }} /> : <p className="dx-muted dx-note">No subjects requested yet.</p>) : <p className="dx-muted dx-note">Loading…</p>}
        </Panel>
        <Panel title="Outcome" subtitle="All applications">
          {stats ? <SplitBar parts={[{ name: "Approved", value: stats.approved, color: SERIES.a }, { name: "Declined", value: stats.declined, color: SERIES.b }, { name: "Waiting", value: stats.waiting, color: SERIES.none }]} /> : <p className="dx-muted dx-note">Loading…</p>}
        </Panel>
      </div>

      {error && <div className="dx-alert error" role="alert">{error}</div>}
      {done && <div className="dx-alert ok" role="status"><CheckCircle2 size={14} aria-hidden="true" style={{ verticalAlign: -2 }} /> {done}</div>}

      <div className="dx-toolbar">
        <Segmented<Tab> label="Status" value={tab} onChange={(v) => { setTab(v); setOpen(""); }}
          options={[{ value: "pending", label: "Waiting", count: stats?.waiting }, { value: "verified", label: "Approved", count: stats?.approved }, { value: "suspended", label: "Declined", count: stats?.declined }, { value: "all", label: "All", count: stats?.total }]} />
        <select className="dx-select" aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)}><option value="">All subjects</option>{(stats?.subjects ?? []).map((s) => <option key={s.subject} value={s.subject}>{s.subject} ({s.n})</option>)}</select>
        <input className="dx-input" type="search" placeholder="Search name, email or school" aria-label="Search applications" value={search} onChange={(e) => setSearch(e.target.value)} />
        {filtered && <button className="dx-link" type="button" onClick={() => { setSubject(""); setSearch(""); }}>Clear filters</button>}
      </div>

      <div className="dx-table-wrap">
        <table className="dx-table">
          <thead><tr><th>Applicant</th><th>School</th><th>Wants to review</th><th className="num">Years</th><th>Applied</th><th>Status</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {all === null ? <tr><td colSpan={7} className="dx-muted">Loading…</td></tr> : !rows.length ? <tr><td colSpan={7} className="dx-muted">{filtered ? "No applications match." : "Nothing here."}</td></tr> : rows.map((a) => {
              const st = STATUS[a.status] ?? { text: a.status, tone: "" };
              const subs = a.requested.map((r) => r.subject_code);
              return (
                <Fragment key={a.user_id}>
                  <tr>
                    <td className="name">{a.name}<div className="dx-muted" style={{ fontWeight: 400, fontSize: 12 }}><a href={`mailto:${a.email}`}>{a.email}</a></div></td>
                    <td>{a.school ?? <span className="dx-muted">—</span>}</td>
                    <td>{subs.slice(0, 3).map((s) => <span key={s} className="dx-pill" style={{ marginInlineEnd: 4 }}>{s}</span>)}{subs.length > 3 && <span className="dx-muted"> +{subs.length - 3}</span>}{!subs.length && <span className="dx-muted">not stated</span>}</td>
                    <td className="num">{a.years_experience}</td>
                    <td title={formatDate(a.applied_at)}>{formatDate(a.applied_at)}{a.status === "pending" && <span className={waitingDays(a) > 7 ? "dx-pill warn" : "dx-muted"} style={{ marginInlineStart: 6 }}>{waitingDays(a)}d</span>}</td>
                    <td><span className={`dx-pill ${st.tone}`}>{st.text}</span></td>
                    <td>{a.status === "pending" && <button className="dx-btn sm" aria-expanded={open === a.user_id} onClick={() => start(a)}>{open === a.user_id ? "Close" : "Review"}</button>}</td>
                  </tr>
                  {a.status !== "pending" && (a.decision_note || a.status === "verified") && <tr className="dx-detail"><td colSpan={7} className="dx-muted" style={{ fontSize: 12.5 }}>
                    {a.status === "verified" ? `Approved with ${a.domains} subject${a.domains === 1 ? "" : "s"}${a.decision_note ? `. Note: ${a.decision_note}` : ""}.` : `${a.decided_at ? `Declined ${formatDate(a.decided_at)}` : "Reviewer access paused"}: ${a.decision_note ?? ""}`}</td></tr>}
                  {open === a.user_id && current && <tr className="dx-detail"><td colSpan={7}>
                    <p style={{ margin: "0 0 8px", whiteSpace: "pre-wrap", fontSize: 13 }}><strong>Qualifications:</strong> {a.qualifications || <span className="dx-muted">none given</span>}</p>
                    <strong style={{ fontSize: 13 }}>Subjects this teacher may review</strong>
                    <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                      {picks.map((p, i) => <div key={i} style={{ display: "grid", gap: 8, gridTemplateColumns: "auto 1.4fr 1fr 1.2fr", alignItems: "center" }}>
                        <input type="checkbox" checked={p.on} aria-label={`Grant ${p.subject}`} onChange={(e) => setPick(i, { on: e.target.checked })} />
                        <input className="dx-input" style={{ width: "100%" }} value={p.subject} aria-label="Subject" onChange={(e) => setPick(i, { subject: e.target.value })} />
                        <input className="dx-input" style={{ width: "100%" }} value={p.level} aria-label="Level" placeholder="Level" onChange={(e) => setPick(i, { level: e.target.value })} />
                        <input className="dx-input" style={{ width: "100%" }} value={p.grades} aria-label="Grades" placeholder="Grades, e.g. B7, B8" onChange={(e) => setPick(i, { grades: e.target.value })} />
                        {owner && <div style={{ gridColumn: "2 / -1", display: "flex", gap: 14, flexWrap: "wrap" }}>
                          <label className="dx-check"><input type="checkbox" checked={p.approve} onChange={(e) => setPick(i, { approve: e.target.checked })} />May approve questions</label>
                          <label className="dx-check"><input type="checkbox" checked={p.senior} onChange={(e) => setPick(i, { senior: e.target.checked })} />Senior reviewer</label></div>}
                      </div>)}
                    </div>
                    {!owner && <p className="dx-muted dx-note">Approval and senior-review rights are granted by the owner.</p>}
                    <label className="dx-form" style={{ display: "grid", gap: 2, marginTop: 8, fontSize: 11.5, color: "var(--ink-muted)" }}>Note (what you checked; for a decline, the reason the teacher will see)
                      <textarea className="dx-textarea" rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></label>
                    <div className="dx-actions" style={{ marginTop: 8 }}>
                      <button className="dx-btn primary" disabled={busy || note.trim().length < 3 || !picks.some((p) => p.on && p.subject.trim())} onClick={() => void decide(a, "approve")}><CheckCircle2 size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Approve</button>
                      <button className="dx-btn danger" disabled={busy || note.trim().length < 10} onClick={() => void decide(a, "decline")}><XCircle size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Decline</button>
                    </div>
                  </td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="dx-pager"><span>{num(rows.length)} of {num(all?.length ?? 0)} applications</span></div>
    </div>
  );
}
