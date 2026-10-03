"use client";

import HomeSections from "@/components/HomeSections";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StatCard from "@/components/StatCard";
import { bootstrapUser } from "@/lib/auth";
import { getStudentDashboard } from "@/lib/api/student";
import { startAttempt } from "@/lib/api/assessment";

export default function StudentDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    bootstrapUser()
      .then((ctx) => {
        const studentId = String((ctx.studentProfile as any)?.id ?? "");
        if (!studentId) throw new Error("Student profile not found.");
        return getStudentDashboard(studentId);
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (!data) return <div>Loading dashboard…</div>;

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Student Dashboard</h1>
          <p>Your classes, assessments and learning progress.</p>
        </div>
        <Link className="qb-btn" href="/student/assessments">
          Start assessment
        </Link>
      </div>
      <HomeSections/>

      <div className="qb-grid cols-4">
        <StatCard value={data.xp?.total_xp ?? 0} label={`XP · Level ${data.xp?.level ?? 1}`} />
        <StatCard value={data.stats.completed} label="Completed attempts" />
        <StatCard
          value={`${Math.round(data.stats.average)}%`}
          label="Average score"
        />
        <StatCard
          value={`${Math.round(data.stats.best)}%`}
          label="Best score"
        />
      </div>

      <div style={{ height: 18 }} />

      <div className="qb-grid cols-2">
        <div className="qb-card">
          <h2>Recent assignments</h2>
          <div className="qb-list">
            {data.assignments.length ? (
              data.assignments.slice(0, 6).map((row: any) => (
                <div key={row.id} className="qb-row">
                  <div className="qb-row-main">
                    <strong>{row.assignments?.title ?? "Assignment"}</strong>
                    {row.assignments?.remediation_node_id && <span className="qb-pill">Remedial Practice</span>}
                    <span>
                      {row.assignments?.subject_code ?? ""}{" "}
                      {row.assignments?.due_at
                        ? `· Due ${new Date(
                            row.assignments.due_at
                          ).toLocaleDateString()}`
                        : ""}
                    </span>
                  </div>
                  {row.assignments?.assessment_id && <button className="qb-btn" onClick={async () => { const attempt: any = await startAttempt({ assessmentId: row.assignments.assessment_id, assignmentId: row.assignment_id, classId: row.class_id }); router.push(`/student/attempt/${attempt.attempt_id}`); }}>Start</button>}
                </div>
              ))
            ) : (
              <div className="qb-muted">No assignments yet.</div>
            )}
          </div>
        </div>

        <div className="qb-card">
          <h2>Recent results</h2>
          <div className="qb-list">
            {data.results.length ? (
              data.results.slice(0, 6).map((row: any) => (
                <div key={row.id} className="qb-row">
                  <div className="qb-row-main">
                    <strong>{row.subject_code ?? "Assessment"}</strong>
                    <span>
                      {row.submitted_at
                        ? new Date(row.submitted_at).toLocaleString()
                        : ""}
                    </span>
                  </div>
                  <strong>{Math.round(Number(row.percentage ?? 0))}%</strong>
                </div>
              ))
            ) : (
              <div className="qb-muted">No results yet.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
