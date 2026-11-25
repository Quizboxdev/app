"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { changeText, classLabel, sortClasses } from "@/lib/admin/dashboard";
import { AREAS, TILES, type Tile } from "@/lib/admin/live";
import { useLiveSection } from "@/components/admin/useLiveSection";
import { Kpi, Panel, RankedBars, Segmented, SERIES, TrendCurve, num } from "@/components/admin/DataViz";

const ROLE_LABEL: Record<string, string> = { student: "Students", teacher: "Teachers", sponsor: "Sponsors", admin: "Admins", owner: "Owners", sme: "SMEs", reviewer: "Reviewers" };
const label = (k: string) => ROLE_LABEL[k.toLowerCase()] ?? k.charAt(0).toUpperCase() + k.slice(1).toLowerCase();
const ago = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 10 ? "just now" : s < 90 ? `${s} seconds ago` : s < 5400 ? `${Math.round(s / 60)} minutes ago` : `${Math.round(s / 3600)} hours ago`; };

// Platform dashboard: figures first, then charts, then what needs attention and every admin area. Three sections load and refresh on their own (see useLiveSection),
// so the page is usable at once, a slow section never blanks the others, and the last good figures stay on screen when a refresh fails.
export default function AdminHomePage() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const queues = useLiveSection("queues", days), people = useLiveSection("people", days), content = useLiveSection("content", days);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const tick = window.setInterval(() => setNow(Date.now()), 5000); return () => window.clearInterval(tick); }, []);

  const sections = [queues, people, content];
  const busy = sections.some((s) => s.busy);
  const error = sections.find((s) => s.error)?.error ?? "";
  const values = sections.flatMap((s) => (s.value ? [s.value] : []));
  const oldest = values.length ? Math.min(...values.map((v) => v.asOf)) : null;
  const status = !values.length ? (error ? { text: "Not available", tone: " warn" } : { text: "Loading", tone: "" })
    : error ? { text: "Showing last figures", tone: " warn" }
      : values.some((v) => v.stale) ? { text: "Updating", tone: "" } : { text: "Live", tone: " ok" };

  const q = queues.data, u = people.data?.users, l = people.data?.learning, markets = people.data?.markets, c = content.data?.content;
  const note = (s: { value: unknown; error: string }) => <p className="dx-muted dx-note">{s.value ? "Not available on this environment yet." : s.error ? "Could not be loaded. It will be tried again." : "Loading…"}</p>;
  const roles = Object.entries(u?.by_role ?? {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: label(k), segments: [{ value: v, color: SERIES.a, name: label(k) }] }));
  const stages = Object.entries(markets ?? {}).map(([k, v]) => ({ key: k, label: label(k), segments: [{ value: v, color: SERIES.a, name: "Markets" }] }));
  const counts = (r: { live: number; in_review: number }) => [{ value: r.live, color: SERIES.a, name: "Live" }, { value: r.in_review, color: SERIES.none, name: "In review" }];
  const classes = sortClasses(c?.by_class ?? []).map((r) => ({ key: r.grade ?? "none", label: classLabel(r.grade), segments: counts(r),
    sub: r.subjects?.map((s) => ({ key: s.subject, label: s.subject, segments: counts(s) })) }));
  const hasSubjects = classes.some((r) => r.sub?.length);

  // A count that is absent is not this person's to see; a count that is null could not be read. Before the first answer every tile shows a dash.
  const visible = (tile: Tile) => !q || tile.key in q;
  const batches = { key: "batches_waiting", label: "Question batches waiting for approval", href: "/admin/question-batches", n: c?.batches_waiting };
  const open = [batches, ...TILES.filter((tile) => tile.action && visible(tile)).map((tile) => ({ ...tile, n: q?.[tile.key] }))]
    .filter((i) => Number(i.n) > 0).sort((a, b) => Number(b.n) - Number(a.n));
  const answered = Boolean(queues.value && content.value);
  const support = q?.support_open;

  return (
    <div className="dx-page">
      <div className="dx-head">
        <div><h1>Platform dashboard</h1><p>Users, learning activity, content and the queues that need a decision.</p></div>
        <div className="dx-actions" style={{ alignItems: "center" }}>
          <span className={`dx-pill${status.tone}`} role="status">{status.text}</span>
          {oldest !== null && <span className="dx-muted dx-note">Updated {ago(now - oldest)}</span>}
          <Segmented<"7" | "30" | "90"> label="Period" value={String(days) as "7" | "30" | "90"} onChange={(v) => setDays(Number(v) as 7 | 30 | 90)} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
          <button className="dx-btn" disabled={busy} aria-label="Refresh" onClick={() => sections.forEach((s) => s.refresh())}><RefreshCw size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Refresh</button>
        </div>
      </div>

      {error && <div className="dx-alert error" role="alert">{error}</div>}

      <div className="dx-kpis">
        <Link href="/admin/markets" className="dx-kpi-link"><Kpi label="Total users" value={u?.total ?? "—"} hint={u ? `${num(u.new_7d)} new this week` : undefined} /></Link>
        <Kpi label="New users, 7 days" value={u?.new_7d ?? "—"} hint={u ? changeText(u.new_7d, u.new_prev_7d) : undefined} />
        <Kpi label="Attempts, 7 days" value={l?.attempts_7d ?? "—"} hint={l ? `${changeText(l.attempts_7d, l.attempts_prev_7d)} · ${num(l.attempts_total)} in total` : undefined} />
        <Link href="/admin/content" className="dx-kpi-link"><Kpi label="Live questions" value={c?.live ?? "—"} hint={c ? `${num(c.in_review)} waiting in review` : undefined} /></Link>
        <Link href="/admin/question-batches" className="dx-kpi-link"><Kpi label="Batches to approve" value={c?.batches_waiting ?? "—"} tone={Number(c?.batches_waiting) > 0 ? "warn" : "default"} hint="Loaded, not yet approved" /></Link>
        <Link href="/admin/support" className="dx-kpi-link"><Kpi label="Support open" value={support ?? "—"} tone={Number(support) > 0 ? "warn" : "default"} hint={typeof q?.support_new_7d === "number" ? `${num(q.support_new_7d)} new this week` : undefined} /></Link>
      </div>

      <div className="dx-grid">
        <Panel title="New accounts per day" subtitle={`Last ${days} days`}>
          {u ? <TrendCurve bucket="day" data={u.signups} series={[{ key: "added", name: "New accounts", color: SERIES.a }]} height={190} /> : note(people)}
        </Panel>
        <Panel title="Learning activity per day" subtitle="Attempts started and submitted">
          {l ? <TrendCurve bucket="day" data={l.daily} series={[{ key: "started", name: "Started", color: SERIES.a }, { key: "submitted", name: "Submitted", color: SERIES.b }]} height={190} /> : note(people)}
        </Panel>
        <div className="dx-stack">
          <Panel title="Users by role">{u ? (roles.length ? <RankedBars rows={roles} limit={6} unit="people" /> : <p className="dx-muted dx-note">No accounts yet.</p>) : note(people)}</Panel>
          <Panel title="Markets by stage">{markets ? (stages.length ? <RankedBars rows={stages} limit={5} unit="markets" /> : <p className="dx-muted dx-note">No markets yet.</p>) : note(people)}</Panel>
        </div>
      </div>

      <div className="dx-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <Panel title="Questions by class" subtitle={hasSubjects ? "Live and waiting in review. Select a class to see its subjects" : "Live and waiting in review"}
          action={<ul className="dx-legend" aria-label="Legend" style={{ margin: 0 }}><li><span className="dx-swatch" style={{ background: SERIES.a }} />Live</li><li><span className="dx-swatch" style={{ background: SERIES.none }} />In review</li></ul>}>
          {c ? (classes.length ? <RankedBars rows={classes} limit={16} unit="questions" /> : <p className="dx-muted dx-note">No questions yet.</p>) : note(content)}
        </Panel>
        <Panel title="Needs attention" action={answered && open.length === 0 ? <span className="dx-pill ok">All clear</span> : undefined}>
          {open.length === 0 ? (answered ? <p className="dx-muted dx-note">Nothing is waiting for a decision.</p> : note(queues)) : (
            <div className="dx-table-wrap" style={{ maxHeight: "none" }}>
              <table className="dx-table">
                <thead><tr><th>Item</th><th className="num">Count</th><th aria-label="Open" /></tr></thead>
                <tbody>
                  {open.map((i) => (
                    <tr key={i.key}>
                      <td className="name" style={{ fontWeight: 500 }}>{i.label}</td>
                      <td className="num"><span className="dx-pill warn">{num(Number(i.n))}</span></td>
                      <td><Link className="dx-btn sm" href={i.href}>Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="dx-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        {AREAS.map((area) => {
          const tiles = TILES.filter((tile) => tile.area === area && visible(tile));
          if (!tiles.length) return null;
          return (
            <Panel key={area} title={area}>
              <div className="dx-table-wrap" style={{ maxHeight: "none" }}>
                <table className="dx-table">
                  <thead><tr><th>Item</th><th className="num">Count</th></tr></thead>
                  <tbody>
                    {tiles.map((tile) => {
                      const n = q?.[tile.key];
                      return (
                        <tr key={tile.key}>
                          <td className="name" style={{ fontWeight: 500 }}><Link href={tile.href}>{tile.label}</Link></td>
                          <td className="num">{typeof n === "number" ? <span className={tile.action && n > 0 ? "dx-pill warn" : undefined}>{num(n)}</span>
                            : <span className="dx-muted" title={q ? "Not available on this environment yet" : "Loading"}>—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
