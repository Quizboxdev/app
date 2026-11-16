"use client";

import { useEffect, useMemo, useState } from "react";
import { setTopicsOpen, topicsOverview, type TopicGroup } from "@/lib/api/topics-admin";
import { describeErrorMessage } from "@/lib/errors";
import { Kpi, Panel, RankedBars, SERIES, num } from "@/components/admin/DataViz";

// Topics for teachers. Loaded questions come with their topics as drafts; teachers and the combined-test screen see only topics that are open.
// A topic can be opened once it holds its target number of approved questions (50 by default, one indicator's worth). Opening is reversible:
// withdrawing a topic hides it from the pickers and never touches a test already published from it.
export default function TopicsForTeachersPage() {
  const [rows, setRows] = useState<TopicGroup[] | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState("");
  const [grade, setGrade] = useState(""), [search, setSearch] = useState("");
  const load = () => topicsOverview().then(setRows).catch((e: Error) => { setError(describeErrorMessage(e.message)); setRows([]); });
  useEffect(() => { void load(); }, []);

  const totals = useMemo(() => (rows ?? []).reduce((t, r) => ({ open: t.open + r.open, ready: t.ready + r.ready, notReady: t.notReady + r.not_ready, approved: t.approved + r.approved_questions }), { open: 0, ready: 0, notReady: 0, approved: 0 }), [rows]);
  const grades = useMemo(() => [...new Set((rows ?? []).map((r) => r.grade))].sort(), [rows]);
  const shown = useMemo(() => { const q = search.trim().toLowerCase(); return (rows ?? []).filter((r) => (!grade || r.grade === grade) && (!q || r.subject.toLowerCase().includes(q))); }, [rows, grade, search]);
  const bars = useMemo(() => (rows ?? []).slice().sort((a, b) => (b.open + b.ready) - (a.open + a.ready)).map((r) => ({ key: `${r.subject}|${r.grade}`, label: `${r.subject} · ${r.grade}`, segments: [{ value: r.open, color: SERIES.d, name: "Open" }, { value: r.ready, color: SERIES.a, name: "Ready to open" }, { value: r.not_ready, color: SERIES.none, name: "Not ready" }] })), [rows]);

  async function change(open: boolean, key: string, subject?: string, grade?: string) {
    const what = subject ? `${subject}, ${grade ?? "all grades"}` : "every subject and grade";
    if (!window.confirm(open ? `Open every ready topic for ${what} to teachers?` : `Withdraw the open topics for ${what} from teachers? Tests already published are not affected.`)) return;
    setBusy(key); setError(""); setNotice("");
    try {
      const r = await setTopicsOpen(open, subject, grade);
      setNotice(open ? `Opened ${r.changed} topic${r.changed === 1 ? "" : "s"} for ${what}.${r.not_ready ? ` ${r.not_ready} are not ready yet (they hold fewer approved questions than their target).` : ""}` : `Withdrew ${r.changed} topic${r.changed === 1 ? "" : "s"} for ${what}.`);
      await load();
    } catch (e) { setError(describeErrorMessage((e as Error).message)); } finally { setBusy(""); }
  }

  return <div className="dx-page">
    <div className="dx-head"><div><h1>Topics for teachers</h1>
      <p>Teachers build tests from topics that are open. A topic is ready to open when it holds its target number of approved questions.</p></div>
      <div className="dx-actions"><button className="dx-btn primary" disabled={busy !== "" || totals.ready === 0} onClick={() => void change(true, "all")}>{busy === "all" ? "Opening…" : `Open all ${totals.ready} ready topics`}</button></div></div>
    {error && <div className="dx-alert error" role="alert">{error}</div>}{notice && <div className="dx-alert ok" role="status">{notice}</div>}
    {rows === null ? <p className="dx-muted" aria-busy="true">Loading topics…</p>
      : rows.length === 0 ? <p className="dx-muted dx-note"><strong>No topics yet.</strong> Topics appear here when questions are loaded with their topics.</p>
      : <>
        <div className="dx-kpis">
          <Kpi label="Open to teachers" value={num(totals.open)} />
          <Kpi label="Ready to open" value={num(totals.ready)} tone={totals.ready > 0 ? "warn" : "default"} />
          <Kpi label="Not ready" value={num(totals.notReady)} hint="below the target" />
          <Kpi label="Approved questions" value={num(totals.approved)} />
        </div>
        <Panel title="Topics by subject and grade" subtitle="Open, ready and not ready (largest first)"><RankedBars rows={bars} unit="topics" limit={10} /></Panel>
        <div className="dx-toolbar">
          <select className="dx-select" aria-label="Grade" value={grade} onChange={(e) => setGrade(e.target.value)}><option value="">All grades</option>{grades.map((g) => <option key={g} value={g}>{g}</option>)}</select>
          <input className="dx-input" type="search" aria-label="Search subjects" placeholder="Search subject" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="dx-table-wrap"><table className="dx-table"><caption className="qb-sr-only">Topics by subject and grade</caption>
          <thead><tr><th>Grade</th><th>Subject</th><th className="num">Open</th><th className="num">Ready to open</th><th className="num">Not ready</th><th className="num">Approved questions</th><th><span className="qb-sr-only">Actions</span></th></tr></thead>
          <tbody>{shown.map((r) => { const key = `${r.subject}|${r.grade}`;
            return <tr key={key}><td>{r.grade}</td><td className="name">{r.subject}</td><td className="num">{r.open}</td><td className="num">{r.ready}</td><td className="num">{r.not_ready}</td><td className="num">{r.approved_questions.toLocaleString()}</td>
              <td><div className="dx-actions">
                <button className="dx-btn sm primary" disabled={busy !== "" || r.ready === 0} onClick={() => void change(true, key, r.subject, r.grade)}>{busy === key ? "Working…" : "Open ready"}</button>
                <button className="dx-btn sm" disabled={busy !== "" || r.open === 0} onClick={() => void change(false, key, r.subject, r.grade)}>Withdraw</button>
              </div></td></tr>; })}</tbody></table></div>
        <div className="dx-pager"><span>{num(shown.length)} of {num(rows.length)} rows</span></div>
        <p className="dx-muted dx-note">Not ready means the topic has fewer approved questions than its target, so it stays hidden until more questions are approved.</p>
      </>}
  </div>;
}
