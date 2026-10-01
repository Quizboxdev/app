"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getMyResults } from "@/lib/api/assessment";

export default function ResultsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    getMyResults(100)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Progress & Results</h1>
          <p>Your submitted assessment history.</p>
        </div>
      </div>

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
