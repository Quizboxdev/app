"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AccessGate from "@/components/mock/AccessGate";
import { listExams, type ExamRow } from "@/lib/api/mock-exams";
import { formatDate } from "@/lib/format";
import { gradeLabel } from "@/lib/mock-exams/grades";
import { purposeLabel } from "@/lib/mock-exams/purposes";

const STATUS: Record<string, [string, string]> = { draft: ["Draft", "warning"], published: ["Published", "success"], archived: ["Archived", "neutral"] };

// Mock exams: cumulative exams built from several years, given to a class or sold on the Marketplace, with results and exports. Open to teachers, verified organisation sponsors and staff once the owner turns the feature on.
function List() {
  const [rows, setRows] = useState<ExamRow[] | null>(null), [error, setError] = useState("");
  useEffect(() => { listExams().then(setRows).catch((e) => { setError(e.message); setRows([]); }); }, []);
  return (
    <>
      <div className="qb-page-head"><div><h1>Mock exams</h1><p>Build an exam from several years: choose a year, a subject, a topic and a number of questions, round by round, until it is the size you want. Give it to a class, read the results, and download them.</p></div>
        <Link className="qb-btn" href="/mock-exams/new">New mock exam</Link></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {rows === null ? <div className="qb-card qb-muted" role="status">Loading…</div> : !rows.length ? <div className="qb-card"><h2>No mock exams yet</h2><p className="qb-muted">Start with the exam&rsquo;s name and target year. For example, a JHS 2 BECE-readiness mock can draw from JHS 1 and JHS 2 topics.</p><Link className="qb-btn" href="/mock-exams/new">Build your first mock exam</Link></div> :
        <div className="qb-card"><div className="qb-table-wrap"><table className="qb-table"><thead><tr><th scope="col">Exam</th><th scope="col">Target year</th><th scope="col">Purpose</th><th scope="col">Questions</th><th scope="col">Status</th><th scope="col">Updated</th><th scope="col"><span className="qb-sr-only">Open</span></th></tr></thead><tbody>
          {rows.map((r) => { const [label, tone] = STATUS[r.status] ?? [r.status, "neutral"]; return <tr key={r.id}><td>{r.title}</td><td>{gradeLabel(r.target_grade)}</td><td>{purposeLabel(r.purpose)}</td><td>{r.selected} of {r.desired_total}</td>
            <td><span className={`qb-pill ${tone}`}>{label}</span>{r.status === "published" && r.dirty ? <span className="qb-small qb-muted"> · unpublished changes</span> : null}{r.version_count ? <span className="qb-small qb-muted"> · v{r.version_count}</span> : null}</td>
            <td className="qb-small">{formatDate(r.updated_at)}</td><td><Link className="qb-link" href={`/mock-exams/${r.id}`}>Open</Link></td></tr>; })}</tbody></table></div></div>}
    </>
  );
}
export default function MockExamsPage() { return <AccessGate>{() => <List />}</AccessGate>; }
