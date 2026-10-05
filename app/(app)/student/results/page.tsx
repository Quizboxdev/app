"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import MasteryBadge from "@/components/MasteryBadge";
import ProgressCard from "@/components/ProgressCard";
import { formatDateTime, isUuid } from "@/lib/format";
import { getMyResultsPage } from "@/lib/api/assessment";
import { studentInsights } from "@/lib/api/platform";
import { practiseHref, subjectLabel } from "@/lib/learning/labels";
import { MASTERY_LEVELS, masteryLevel } from "@/lib/learning/mastery";
import { classifyProficiency } from "@/lib/learning/proficiency";

// Progress: QuizBox mastery by subject and topic (server-derived by qb_student_insights) plus the submitted-result history.
// Insights currently report subject and topic; strand / sub-strand grouping needs the server to return those levels.
export default function ProgressPage() {
  const [insights, setInsights] = useState<Record<string, any> | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1), [total, setTotal] = useState(0), [loading, setLoading] = useState(false);

  useEffect(() => { studentInsights().then(setInsights).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    let active = true; setLoading(true);
    getMyResultsPage(page)
      .then((result) => { if (active) { setRows(result.rows); setTotal(result.total); } })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page]);

  const subjects: any[] = (insights?.by_subject ?? []).map((s: any) => ({ ...s, label: subjectLabel(s.subject), mastery: Number(s.mastery) }));
  const topics: any[] = insights?.weak_topics ?? [];
  const counts = Object.fromEntries(MASTERY_LEVELS.map((level) => [level, subjects.filter((s) => masteryLevel(s.mastery, s.topics != null ? Number(s.topics) : undefined) === level).length]));
  const change = insights?.recent_improvement;

  return (
    <>
      <div className="qb-page-head"><div><h1>Progress</h1><p>Mastery by subject and topic, and your submitted results.</p></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}

      <section className="qb-card" aria-labelledby="pg-mastery">
        <div className="qb-page-head"><h2 id="pg-mastery">Mastery by subject</h2>
          {change != null && <span className={`qb-pill ${change > 0 ? "success" : change < 0 ? "amber" : "neutral"}`}>{change > 0 ? "+" : ""}{change} pts vs previous five</span>}
        </div>
        <p className="qb-level-legend">{MASTERY_LEVELS.map((level) => <span key={level}>{level}: <strong>{insights ? counts[level] : "—"}</strong></span>)}</p>
        {!insights ? <div className="qb-subject-list" aria-busy="true">{[1, 2].map((i) => <div key={i} className="qb-subject qb-skeleton" style={{ minHeight: 96 }} />)}</div>
          : subjects.length ? <div className="qb-subject-list">{subjects.map((s) => <ProgressCard key={s.label} name={s.label} percentage={s.mastery} evidence={s.topics != null ? Number(s.topics) : undefined} detail={s.topics != null ? `${s.topics} topic${Number(s.topics) === 1 ? "" : "s"}` : undefined} href={practiseHref(s.subject)} />)}</div>
            : <div className="qb-empty"><strong>No mastery data yet</strong>Practise or complete an assessment to see where you stand.</div>}
      </section>

      <section className="qb-card" style={{ marginTop: 16 }} aria-labelledby="pg-weak">
        <h2 id="pg-weak">Topics that need work</h2>
        {topics.length ? <ul className="qb-task-list">{topics.map((t) => <li key={t.topic}>
          <div className="qb-row-main"><strong>{t.topic}</strong><span>{Math.round(Number(t.mastery))}% mastery</span></div>
          <MasteryBadge percentage={Number(t.mastery)} />
        </li>)}</ul> : <div className="qb-empty"><strong>No weak topics identified</strong>Keep practising; topics that need attention appear here.</div>}
      </section>

      <section className="qb-card" style={{ marginTop: 16 }} aria-labelledby="pg-history">
        <div className="qb-page-head"><h2 id="pg-history">Results history</h2>
          <div className="qb-actions"><span className="qb-small qb-muted">Page {page} of {Math.max(1, Math.ceil(total / 25))}</span>
            <button title="Previous page" aria-label="Previous page" disabled={loading || page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={18} /></button>
            <button title="Next page" aria-label="Next page" disabled={loading || page * 25 >= total} onClick={() => setPage(page + 1)}><ChevronRight size={18} /></button></div>
        </div>
        {!rows.length && !loading ? <div className="qb-empty"><strong>No submitted results yet</strong>Finished practice and assessments appear here.</div> : (
          <div className="qb-table-wrap">
            <table className="qb-table">
              <thead><tr><th>Subject</th><th>Score</th><th>Proficiency</th><th>Outcome</th><th>Date</th><th><span className="qb-sr-only">Actions</span></th></tr></thead>
              <tbody>{rows.map((row) => <tr key={row.id}>
                <td>{!row.subject_code || isUuid(row.subject_code) ? "Assessment" : subjectLabel(row.subject_code)}</td>
                <td>{row.score}/{row.total_marks} · {Math.round(Number(row.percentage ?? 0))}%</td>
                <td>{classifyProficiency(Number(row.percentage ?? 0))}</td>
                <td><StatusBadge status={row.passed ? "passed" : "pending"} tone={row.passed ? "success" : "warning"} label={row.passed ? "Passed" : "Not passed"} /></td>
                <td>{formatDateTime(row.submitted_at, "")}</td>
                <td><Link className="qb-btn ghost" href={`/student/results/${row.attempt_id}`}>Review</Link></td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
