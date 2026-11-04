"use client";

import { useEffect, useMemo, useState } from "react";
import { setTopicsOpen, topicsOverview, type TopicGroup } from "@/lib/api/topics-admin";
import { describeErrorMessage } from "@/lib/errors";

// Topics for teachers. Loaded questions come with their topics as drafts; teachers and the combined-test screen see only topics that are open.
// A topic can be opened once it holds its target number of approved questions (50 by default, one indicator's worth). Opening is reversible:
// withdrawing a topic hides it from the pickers and never touches a test already published from it.
export default function TopicsForTeachersPage() {
  const [rows, setRows] = useState<TopicGroup[] | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState("");
  const load = () => topicsOverview().then(setRows).catch((e: Error) => { setError(describeErrorMessage(e.message)); setRows([]); });
  useEffect(() => { void load(); }, []);

  const totals = useMemo(() => (rows ?? []).reduce((t, r) => ({ open: t.open + r.open, ready: t.ready + r.ready, notReady: t.notReady + r.not_ready }), { open: 0, ready: 0, notReady: 0 }), [rows]);

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

  return <>
    <div className="qb-page-head"><div><h1>Topics for teachers</h1>
      <p>Teachers build tests from topics that are open. A topic is ready to open when it holds its target number of approved questions.</p></div></div>
    {error && <div className="qb-card qb-error" role="alert">{error}</div>}{notice && <div className="qb-card" role="status">{notice}</div>}
    {rows === null ? <div className="qb-card qb-skeleton" aria-busy="true" aria-label="Loading topics" />
      : rows.length === 0 ? <div className="qb-card qb-empty"><strong>No topics yet</strong>Topics appear here when questions are loaded with their topics.</div>
      : <section className="qb-card" aria-labelledby="tp-title">
        <div className="qb-page-head"><h2 id="tp-title">{totals.open} open · {totals.ready} ready to open · {totals.notReady} not ready</h2>
          <button className="qb-btn" disabled={busy !== "" || totals.ready === 0} onClick={() => void change(true, "all")}>{busy === "all" ? "Opening…" : `Open all ${totals.ready} ready topics`}</button></div>
        <div className="qb-table-wrap"><table className="qb-table"><caption className="qb-sr-only">Topics by subject and grade</caption>
          <thead><tr><th>Grade</th><th>Subject</th><th>Open</th><th>Ready to open</th><th>Not ready</th><th>Approved questions</th><th><span className="qb-sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.map((r) => { const key = `${r.subject}|${r.grade}`;
            return <tr key={key}><td>{r.grade}</td><td>{r.subject}</td><td>{r.open}</td><td>{r.ready}</td><td>{r.not_ready}</td><td>{r.approved_questions.toLocaleString()}</td>
              <td><div className="qb-actions">
                <button className="qb-btn secondary" disabled={busy !== "" || r.ready === 0} onClick={() => void change(true, key, r.subject, r.grade)}>{busy === key ? "Working…" : "Open ready"}</button>
                <button className="qb-btn ghost" disabled={busy !== "" || r.open === 0} onClick={() => void change(false, key, r.subject, r.grade)}>Withdraw</button>
              </div></td></tr>; })}</tbody></table></div>
        <p className="qb-muted qb-small">Not ready means the topic has fewer approved questions than its target, so it stays hidden until more questions are approved.</p>
      </section>}
  </>;
}
