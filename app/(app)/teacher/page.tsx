"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import { bootstrapUser } from "@/lib/auth";
import { getTeacherDashboard } from "@/lib/api/teacher";

export default function TeacherDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    bootstrapUser()
      .then((ctx) => {
        const teacherId = String((ctx.teacherProfile as any)?.id ?? "");
        if (!teacherId) throw new Error("Teacher profile not found.");
        return getTeacherDashboard(teacherId, ctx.userId);
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (!data) return <div>Loading teacher dashboard…</div>;

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Teacher Dashboard</h1>
          <p>Manage classes, assignments, question banks and results.</p>
        </div>
      </div>

      <div className="qb-grid cols-4">
        <StatCard value={data.classes.length} label="Classes" />
        <StatCard value={data.assignments.length} label="Assignments" />
        <StatCard value={data.questionBanks.length} label="Question banks" />
        <StatCard value={data.gradebook.length} label="Gradebook records" />
      </div>

      <div style={{ height: 18 }} />

      <div className="qb-grid cols-2">
        <div className="qb-card">
          <h2>Recent assignments</h2>
          <div className="qb-list">
            {data.assignments.slice(0, 6).map((row: any) => (
              <div className="qb-row" key={row.id}>
                <div className="qb-row-main">
                  <strong>{row.title ?? "Assignment"}</strong>
                  <span>{row.subject_code ?? ""} · {row.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="qb-card">
          <h2>Recent grades</h2>
          <div className="qb-list">
            {data.gradebook.slice(0, 6).map((row: any) => (
              <div className="qb-row" key={row.id}>
                <div className="qb-row-main">
                  <strong>{row.student_name ?? row.student_email ?? "Student"}</strong>
                  <span>{row.status ?? ""}</span>
                </div>
                <strong>{Math.round(Number(row.percentage ?? 0))}%</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
