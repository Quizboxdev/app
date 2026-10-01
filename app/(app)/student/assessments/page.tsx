"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listAvailableAssessments,
  startAttempt,
} from "@/lib/api/assessment";

export default function StudentAssessmentsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    listAvailableAssessments()
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);

  async function begin(row: any) {
    setStarting(row.id);
    setError("");
    try {
      const attempt = await startAttempt({
        assessmentId: row.id,
        assignmentId: row.reference_type === "ASSIGNMENT" ? row.reference_id : null,
        classId: null,
      });
      router.push(`/student/attempt/${attempt.attempt_id}`);
    } catch (e: any) {
      setError(e.message);
      setStarting(null);
    }
  }

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Assessments</h1>
          <p>Practice, assignments and competition assessments available to you.</p>
        </div>
      </div>

      {error && <div className="qb-card qb-error">{error}</div>}

      <div className="qb-list">
        {rows.map((row) => (
          <div key={row.id} className="qb-row">
            <div className="qb-row-main">
              <strong>{row.title ?? row.subject_name ?? "Assessment"}</strong>
              <span>
                {row.assessment_type} · {row.subject_code ?? ""} ·{" "}
                {row.time_limit_minutes ?? 30} min
              </span>
            </div>
            <button
              className="qb-btn"
              disabled={starting === row.id}
              onClick={() => begin(row)}
            >
              {starting === row.id ? "Starting…" : "Start"}
            </button>
          </div>
        ))}

        {!rows.length && !error && (
          <div className="qb-card qb-muted">No assessments available.</div>
        )}
      </div>
    </>
  );
}
