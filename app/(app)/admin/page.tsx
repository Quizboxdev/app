"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getOperationsHealth } from "@/lib/api/admin";
import { changeText, getAdminDashboard, sortClasses, type Dash } from "@/lib/admin/dashboard";
import { Kpi, Panel, RankedBars, Segmented, SERIES, TrendCurve, num } from "@/components/admin/DataViz";

type Health = { unresolved_source_issues?: number; unresolved_compensation?: number } | null;
const ROLE_LABEL: Record<string, string> = { student: "Students", teacher: "Teachers", sponsor: "Sponsors", admin: "Admins", owner: "Owners", sme: "SMEs", reviewer: "Reviewers" };
const label = (k: string) => ROLE_LABEL[k.toLowerCase()] ?? k.charAt(0).toUpperCase() + k.slice(1).toLowerCase();

// Platform dashboard: figures first, then charts, then what needs attention. All figures come from one read-only call (qb_admin_dashboard); a section that is not available on this environment says so instead of breaking the page.
export default function AdminHomePage() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [d, setD] = useState<Dash | null>(null), [health, setHealth] = useState<Health>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(true);

  const load = useCallback(() => {
    setBusy(true); setError("");
    Promise.all([getAdminDashboard(days), getOperationsHealth().catch(() => null)])
      .then(([dash, h]) => { setD(dash); setHealth(h); })
      .catch((e) => setError(e.message)).finally(() => setBusy(false));
  }, [days]);
  useEffect(load, [load]);

  const u = d?.users, l = d?.learning, c = d?.content, q = d?.queues;
  const na = <p className="dx-muted dx-note">Not available on this environment yet.</p>;
  const loading = <p className="dx-muted dx-note">Loading…</p>;
  const roles = Object.entries(u?.by_role ?? {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: label(k), segments: [{ value: v, color: SERIES.a, name: label(k) }] }));
  const stages = Object.entries(d?.markets ?? {}).map(([k, v]) => ({ key: k, label: label(k), segments: [{ value: v, color: SERIES.a, name: "Markets" }] }));
  const classes = sortClasses(c?.by_class ?? []).map((r) => ({ key: r.grade, label: r.grade, segments: [{ value: r.live, color: SERIES.a, name: "Live" }, { value: r.in_review, color: SERIES.none, name: "In review" }] }));

  const items: { label: string; n: number | null | undefined; href: string; action: string }[] = [
    { label: "Question batches waiting for approval", n: c?.batches_waiting, href: "/admin/question-batches", action: "Approve" },
    { label: "Support requests open", n: q?.support_open, href: "/admin/support", action: "Open" },
    { label: "Schools waiting for review", n: d?.schools?.waiting, href: "/admin/schools", action: "Review" },
    { label: "Markets still being set up", n: d?.markets?.CONFIGURING, href: "/admin/market-setup", action: "Open" },
    { label: "Source issues to resolve", n: health?.unresolved_source_issues, href: "/admin/curriculum-sources", action: "Review" },
    { label: "Compensation to resolve", n: health?.unresolved_compensation, href: "/admin/compensation", action: "Resolve" },
  ];
  const open = items.filter((i) => Number(i.n) > 0);

  return (
    <div className="dx-page">
      <div className="dx-head">
        <div><h1>Platform dashboard</h1><p>Users, learning activity, content and the queues that need a decision.</p></div>
        <div className="dx-actions" style={{ alignItems: "center" }}>
          <Segmented<"7" | "30" | "90"> label="Period" value={String(days) as "7" | "30" | "90"} onChange={(v) => setDays(Number(v) as 7 | 30 | 90)} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
          <button className="dx-btn" disabled={busy} aria-label="Refresh" onClick={load}><RefreshCw size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Refresh</button>
        </div>
      </div>

      {error && <div className="dx-alert error" role="alert">{error}</div>}

      <div className="dx-kpis">
        <Link href="/admin/markets" className="dx-kpi-link"><Kpi label="Total users" value={u?.total ?? "—"} hint={u ? `${num(u.new_7d)} new this week` : undefined} /></Link>
        <Kpi label="New users, 7 days" value={u?.new_7d ?? "—"} hint={u ? changeText(u.new_7d, u.new_prev_7d) : undefined} />
        <Kpi label="Attempts, 7 days" value={l?.attempts_7d ?? "—"} hint={l ? `${changeText(l.attempts_7d, l.attempts_prev_7d)} · ${num(l.attempts_total)} in total` : undefined} />
        <Link href="/admin/content" className="dx-kpi-link"><Kpi label="Live questions" value={c?.live ?? "—"} hint={c ? `${num(c.in_review)} waiting in review` : undefined} /></Link>
        <Link href="/admin/question-batches" className="dx-kpi-link"><Kpi label="Batches to approve" value={c?.batches_waiting ?? "—"} tone={c && c.batches_waiting > 0 ? "warn" : "default"} hint="Loaded, not yet approved" /></Link>
        <Link href="/admin/support" className="dx-kpi-link"><Kpi label="Support open" value={q?.support_open ?? "—"} tone={q && q.support_open > 0 ? "warn" : "default"} hint={q ? `${num(q.support_new_7d)} new this week` : undefined} /></Link>
      </div>

      <div className="dx-grid">
        <Panel title="New accounts per day" subtitle={`Last ${days} days`}>
          {busy && !d ? loading : u ? <TrendCurve bucket="day" data={u.signups} series={[{ key: "added", name: "New accounts", color: SERIES.a }]} height={190} /> : na}
        </Panel>
        <Panel title="Learning activity per day" subtitle="Attempts started and submitted">
          {busy && !d ? loading : l ? <TrendCurve bucket="day" data={l.daily} series={[{ key: "started", name: "Started", color: SERIES.a }, { key: "submitted", name: "Submitted", color: SERIES.b }]} height={190} /> : na}
        </Panel>
        <div className="dx-stack">
          <Panel title="Users by role">{busy && !d ? loading : u ? (roles.length ? <RankedBars rows={roles} limit={6} unit="people" /> : <p className="dx-muted dx-note">No accounts yet.</p>) : na}</Panel>
          <Panel title="Markets by stage">{busy && !d ? loading : d?.markets ? (stages.length ? <RankedBars rows={stages} limit={5} unit="markets" /> : <p className="dx-muted dx-note">No markets yet.</p>) : na}</Panel>
        </div>
      </div>

      <div className="dx-grid" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)" }}>
        <Panel title="Questions by class" subtitle="Live and waiting in review"
          action={<ul className="dx-legend" aria-label="Legend" style={{ margin: 0 }}><li><span className="dx-swatch" style={{ background: SERIES.a }} />Live</li><li><span className="dx-swatch" style={{ background: SERIES.none }} />In review</li></ul>}>
          {busy && !d ? loading : c ? (classes.length ? <RankedBars rows={classes} limit={10} unit="questions" /> : <p className="dx-muted dx-note">No questions yet.</p>) : na}
        </Panel>
        <Panel title="Needs attention" action={open.length === 0 && d ? <span className="dx-pill ok">All clear</span> : undefined}>
          <div className="dx-table-wrap" style={{ maxHeight: "none" }}>
            <table className="dx-table">
              <thead><tr><th>Item</th><th className="num">Count</th><th aria-label="Open" /></tr></thead>
              <tbody>
                {items.map((i) => {
                  const known = i.n !== null && i.n !== undefined;
                  return (
                    <tr key={i.label}>
                      <td className="name" style={{ fontWeight: 500 }}>{i.label}</td>
                      <td className="num">{known ? <span className={Number(i.n) > 0 ? "dx-pill warn" : "dx-muted"}>{num(Number(i.n))}</span> : <span className="dx-muted" title="Not reported on this environment yet">—</span>}</td>
                      <td>{known && Number(i.n) > 0 && <Link className="dx-btn sm" href={i.href}>{i.action}</Link>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      {d && <p className="dx-muted dx-note">Updated {new Date(d.generated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.</p>}
    </div>
  );
}
