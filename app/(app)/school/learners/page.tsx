"use client";
import { useMemo, useState } from "react";
import { useSchool } from "@/components/SchoolProvider";
import { formatDate } from "@/lib/format";
import { currentLearners, gradeCompare, HISTORY_LIMIT } from "@/lib/school/insights";

// Learner directory from class membership history: name, class, grade, join date. No scores or private data.
export default function SchoolLearnersPage() {
  const { overview, history } = useSchool();
  const [query, setQuery] = useState(""), [cls, setCls] = useState("");
  const learners = useMemo(() => currentLearners(history, overview.classes), [history, overview]);
  const classNames = useMemo(() => [...new Set(learners.map((l) => l.class))].sort(gradeCompare), [learners]);
  const rows = useMemo(() => learners.filter((l) => (!cls || l.class === cls) && (!query.trim() || l.student.toLowerCase().includes(query.trim().toLowerCase()))), [learners, cls, query]);

  return <>
    <div className="qb-page-head"><div><h1>Learners</h1><p>{learners.length} learner{learners.length === 1 ? "" : "s"} in recent class membership records</p></div></div>
    {history.length >= HISTORY_LIMIT && <p className="qb-card qb-muted" role="note">Showing learners from the latest {HISTORY_LIMIT} membership records. Older memberships are not listed.</p>}
    <section className="qb-card" aria-label="Learner list">
      <div className="qb-content-filters">
        <div className="qb-field"><label htmlFor="l-search">Search learners</label><input id="l-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <div className="qb-field"><label htmlFor="l-class">Class</label><select id="l-class" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">All classes</option>{classNames.map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
      </div>
      {rows.length ? <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Learner</th><th>Class</th><th>Grade</th><th>Joined</th></tr></thead><tbody>
        {rows.map((l) => <tr key={`${l.student}|${l.class}`}><td><strong>{l.student}</strong></td><td>{l.class}</td><td>{l.grade}</td><td>{formatDate(l.joinedAt)}</td></tr>)}
      </tbody></table></div> : <div className="qb-empty"><strong>No learners found</strong>{learners.length ? "Clear the search or class filter." : "Learners appear once they join a class."}</div>}
    </section>
  </>;
}
