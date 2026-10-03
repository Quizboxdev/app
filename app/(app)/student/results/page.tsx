"use client";

import { StudentInsights } from "@/components/Insights";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getMyResultsPage } from "@/lib/api/assessment";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function ResultsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1), [total, setTotal] = useState(0), [loading,setLoading]=useState(false);

  useEffect(() => {
    let active=true;setLoading(true);
    getMyResultsPage(page)
      .then((result) => {if(active){setRows(result.rows);setTotal(result.total);setError("");}})
      .catch((e) => {if(active)setError(e.message);})
      .finally(()=>{if(active)setLoading(false);});
    return () => {active=false;};
  }, [page]);

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Progress & Results</h1>
          <p>Your submitted assessment history.</p>
        </div>
      </div>
      <StudentInsights/>
      <div className="qb-page-head"><span>Page {page} of {Math.max(1,Math.ceil(total/25))}</span><div className="qb-actions"><button title="Previous page" aria-label="Previous page" disabled={loading || page===1} onClick={()=>setPage(page-1)}><ChevronLeft size={18}/></button><button title="Next page" aria-label="Next page" disabled={loading || page*25>=total} onClick={()=>setPage(page+1)}><ChevronRight size={18}/></button></div></div>
      {!rows.length && !loading && <p>No submitted results yet.</p>}

      {error && <div className="qb-card qb-error">{error}</div>}

      <div className="qb-card qb-table-wrap">
        <table className="qb-table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Score</th>
              <th>Percentage</th>
              <th>Outcome</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.subject_code ?? "Assessment"}</td>
                <td>
                  {row.score}/{row.total_marks}
                </td>
                <td>{Math.round(Number(row.percentage ?? 0))}%</td>
                <td>{row.passed ? "Passed" : "Not passed"}</td>
                <td>
                  {row.submitted_at
                    ? new Date(row.submitted_at).toLocaleString()
                    : ""}
                </td>
                <td>
                  <Link
                    className="qb-btn ghost"
                    href={`/student/results/${row.attempt_id}`}
                  >
                    Review
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
