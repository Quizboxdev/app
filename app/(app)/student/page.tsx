
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StatCard from "@/components/StatCard";
import { bootstrapUser } from "@/lib/auth";
import { getStudentDashboard, getStudentCompetitionAnalytics, getStudentAchievements } from "@/lib/api/student";
import { startAttempt } from "@/lib/api/assessment";
import MasteryRing from "@/components/charts/MasteryRing";
import TrendChart from "@/components/charts/TrendChart";
import MasteryBar from "@/components/charts/MasteryBar";
import AchievementBadge from "@/components/achievements/AchievementBadge";

export default function StudentDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [compData, setCompData] = useState<any>(null);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    bootstrapUser()
      .then(async (ctx) => {
        const studentId = String((ctx.studentProfile as any)?.id ?? "");
        if (!studentId) throw new Error("Student profile not found.");
        
        const [dash, comp, ach] = await Promise.all([
          getStudentDashboard(studentId),
          getStudentCompetitionAnalytics(studentId).catch(() => null),
          getStudentAchievements(studentId).catch(() => [])
        ]);
        
        setData(dash);
        setCompData(comp);
        setAchievements(ach);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, []);

  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (busy) return (
    <div className="qb-home" aria-busy="true">
      <div className="qb-page-head">
        <div style={{ width: "120px", height: "24px", background: "var(--qb-surface-muted)", borderRadius: "4px" }} />
      </div>
      <div className="qb-home-grid">
        {[1, 2, 3].map((i) => (
          <div key={i} className="qb-card" style={{ minHeight: "150px", background: "var(--qb-surface)", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ width: "100%", height: "100%", background: "var(--qb-surface-muted)", borderRadius: "8px" }} />
          </div>
        ))}
      </div>
    </div>
  );

  // Group subject mastery
  const subjects: Record<string, { total: number; count: number }> = {};
  (data.results ?? []).forEach((row: any) => {
    const code = row.subject_code ?? "General";
    if (!subjects[code]) subjects[code] = { total: 0, count: 0 };
    subjects[code].total += Number(row.percentage ?? 0);
    subjects[code].count += 1;
  });

  const subjectMastery = Object.entries(subjects).map(([name, val]) => ({
    name,
    percentage: Math.round(val.total / val.count)
  }));

  const trendData = [...(data.results ?? [])].reverse().map((r: any, idx) => ({
    name: r.submitted_at ? new Date(r.submitted_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : `Attempt ${idx + 1}`,
    score: Math.round(Number(r.percentage ?? 0))
  }));

  const xpLevel = data.xp?.level ?? 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div className="qb-page-head">
        <div>
          <h1>Student Dashboard</h1>
          <p>Your classes, assessments, competitions, and learning progress.</p>
        </div>
        <Link className="qb-btn" href="/student/assessments">
          Start assessment
        </Link>
      </div>

      <div className="qb-grid cols-3">
        <section className="qb-card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <h2 style={{ alignSelf: "flex-start", marginBottom: "16px" }}>Overall Mastery</h2>
          {data.stats.completed > 0 ? (
            <MasteryRing percentage={Math.round(data.stats.average)} label="Average Score" size={140} color="var(--qb-primary)" />
          ) : (
            <div className="qb-muted" style={{ padding: "32px 0" }}>Not enough data</div>
          )}
        </section>

        <section className="qb-card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <h2 style={{ alignSelf: "flex-start", marginBottom: "16px" }}>Current Level</h2>
          <AchievementBadge type="mastery" tier={xpLevel > 10 ? "gold" : xpLevel > 5 ? "silver" : "standard"} label={`Level ${xpLevel}`} subtext={`${data.xp?.total_xp ?? 0} Total XP`} size="lg" />
        </section>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <StatCard value={data.stats.completed} label="Completed Assessments" />
          <StatCard value={`${Math.round(data.stats.best)}%`} label="Best Score" />
        </div>
      </div>

      <div className="qb-grid cols-2">
        <section className="qb-card">
          <h2>Performance Trend</h2>
          {trendData.length > 1 ? (
            <TrendChart data={trendData} height={200} yAxisLabel="Score %" />
          ) : (
            <div className="qb-muted" style={{ padding: "32px 0" }}>Complete at least 2 assessments to see trends.</div>
          )}
        </section>

        <section className="qb-card">
          <h2>Subject Mastery</h2>
          {subjectMastery.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "16px" }}>
              {subjectMastery.map((sub) => (
                <MasteryBar key={sub.name} label={sub.name} percentage={sub.percentage} color="var(--qb-success)" />
              ))}
            </div>
          ) : (
            <div className="qb-muted" style={{ padding: "32px 0" }}>Not enough data.</div>
          )}
        </section>
      </div>

      <div className="qb-grid cols-2">
        <section className="qb-card">
          <h2>Competitions & Rankings</h2>
          <div className="qb-grid cols-2" style={{ gap: "12px", marginBottom: "16px" }}>
            <StatCard value={compData?.competitions_entered ?? 0} label="Entered" />
            <StatCard value={compData?.competitions_completed ?? 0} label="Completed" />
            <StatCard value={compData?.top_3_finishes ?? 0} label="Top 3 Finishes" />
            <StatCard value={compData?.current_rank ?? "Unranked"} label="Current Rank" />
          </div>
          {compData?.competitions_entered === 0 && (
            <div className="qb-muted" style={{ textAlign: "center", padding: "16px 0" }}>No competition history yet</div>
          )}
        </section>
        
        <section className="qb-card">
          <h2>Trophy Cabinet</h2>
          <div className="qb-grid cols-3">
            {achievements.length > 0 ? achievements.map((ach) => (
              <div key={ach.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
                <AchievementBadge type={ach.type.toLowerCase() === 'championship' ? 'championship' : 'mastery'} tier={ach.tier?.toLowerCase() || 'standard'} size="md" label={ach.title} />
              </div>
            )) : (
              <div className="qb-muted" style={{ gridColumn: "span 3", textAlign: "center", padding: "32px 0" }}>No achievements yet</div>
            )}
          </div>
        </section>
      </div>

      <section className="qb-card">
        <h2>Recent Assignments</h2>
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
      </section>
    </div>
  );
}
