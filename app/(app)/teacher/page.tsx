"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import { bootstrapUser } from "@/lib/auth";
import { getTeacherAnalytics, getTeacherDashboard, listIndicatorLearners } from "@/lib/api/teacher";

export default function TeacherDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [drilldown, setDrilldown] = useState<any>(null);
  const [selectedLearners, setSelectedLearners] = useState<string[]>([]);

  useEffect(() => {
    bootstrapUser()
      .then((ctx) => {
        const teacherId = String((ctx.teacherProfile as any)?.id ?? "");
        if (!teacherId) throw new Error("Teacher profile not found.");
        return Promise.all([getTeacherDashboard(teacherId, ctx.userId), getTeacherAnalytics(teacherId)]);
      })
      .then(([dashboard, analytics]) => setData({ ...dashboard, analytics }))
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
      <div style={{ height: 18 }} />
      <div className="qb-card"><h2>Class proficiency</h2>{data.analytics.classes.length ? data.analytics.classes.map((row: any) => <div key={row.id} className="qb-card"><h3>{row.class_name}</h3><p>Average {row.average}% · Completion {row.completionRate}%</p><div className="qb-list">{row.bands.map((band: any) => <div className="qb-row" key={band.label}><span>{band.label}</span><strong>{band.count} · {band.percentage}%</strong></div>)}</div></div>) : <p className="qb-muted">No completed learner attempts yet.</p>}</div>
      <div style={{ height: 18 }} />
      <div className="qb-grid cols-2"><div className="qb-card"><h2>Weak indicators</h2><div className="qb-list">{data.analytics.indicators.slice(0, 8).map((row: any) => <div className="qb-row" key={row.code}><div className="qb-row-main"><strong>{row.code}</strong><span>{row.title} · {row.learnerCount} learners · {row.attemptCount} attempts</span></div><span>{row.averageAccuracy}% accuracy · {row.averageMastery}% mastery</span></div>)}{!data.analytics.indicators.length && <p className="qb-muted">No learning events yet.</p>}</div></div><div className="qb-card"><h2>Needs attention</h2><div className="qb-list">{data.analytics.needsAttention.map((row: any) => <div className="qb-row" key={row.code}><div className="qb-row-main"><strong>{row.code}</strong><span>{row.title}</span></div><span>{row.learnerCount} affected · {row.averageMastery}% mastery</span><button className="qb-btn secondary" type="button" onClick={async () => { try { const learners = await listIndicatorLearners(row.classId, row.curriculumNodeId); setDrilldown({ row, learners }); setSelectedLearners(learners.map((learner: any) => learner.student_user_id)); } catch (reason: any) { setError(reason.message); } }}>View learners</button><button className="qb-btn secondary" type="button" disabled>Create remedial practice</button></div>)}{!data.analytics.needsAttention.length && <p className="qb-muted">No indicators need attention.</p>}</div></div></div>
      {drilldown && <div className="qb-card"><h2>Affected learners: {drilldown.row.code}</h2><p>{selectedLearners.length} selected</p><div className="qb-actions"><button className="qb-btn secondary" type="button" onClick={() => setSelectedLearners(drilldown.learners.map((learner: any) => learner.student_user_id))}>Select all</button><button className="qb-btn secondary" type="button" onClick={() => setSelectedLearners([])}>Clear selection</button><button className="qb-btn" type="button" disabled>Create remedial practice</button></div><div className="qb-list">{drilldown.learners.map((learner: any) => <label className="qb-row" key={learner.student_user_id}><input type="checkbox" checked={selectedLearners.includes(learner.student_user_id)} onChange={() => setSelectedLearners((current) => current.includes(learner.student_user_id) ? current.filter((id) => id !== learner.student_user_id) : [...current, learner.student_user_id])} /><span><strong>{learner.student_name ?? learner.student_email}</strong><small>Latest {learner.latestScore}% · Mastery {learner.masteryScore}% · {learner.proficiencyState} · {learner.attemptsCount} attempts · {learner.lastPracticedAt ? new Date(learner.lastPracticedAt).toLocaleDateString() : ""}</small></span></label>)}</div></div>}
    </>
  );
}
