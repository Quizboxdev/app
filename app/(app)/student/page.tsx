
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
  const [studentName, setStudentName] = useState("");

  useEffect(() => {
    bootstrapUser()
      .then(async (ctx) => {
        const studentId = String((ctx.studentProfile as any)?.id ?? "");
        if (!studentId) throw new Error("Student profile not found.");
        
        setStudentName(String((ctx.profile as any)?.full_name ?? "Student").split(" ")[0]);

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
          <p>Track your progress, take on new challenges and keep growing.</p>
        </div>
      </div>

      <div 
        style={{
          borderRadius: "var(--radius-xl)",
          background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
          padding: "2rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "2rem",
        }}
      >
        <div>
          <div style={{ color: "var(--color-text-muted)", fontSize: "1rem", marginBottom: "4px" }}>Good morning,</div>
          <h2 style={{ fontSize: "2.5rem", fontWeight: 800, margin: "0 0 12px 0", color: "var(--color-text)" }}>{studentName}! 👋</h2>
          <p style={{ color: "var(--color-text-muted)", margin: 0, maxWidth: "400px", lineHeight: 1.5 }}>
            Consistency today builds the results you want tomorrow.<br/>Let&apos;s keep the momentum going!
          </p>
        </div>
        <div style={{ background: "var(--color-surface)", padding: "1.5rem", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-md)", minWidth: "280px" }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)", padding: "4px 8px", borderRadius: "4px", fontSize: "0.75rem", fontWeight: 650 }}>📅 Upcoming Challenge</span>
          </div>
          <strong style={{ display: "block", fontSize: "1.125rem", marginBottom: "4px", color: "var(--color-text)" }}>Mathematics Mastery</strong>
          <div style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "16px" }}>30 questions • 20 mins • SHS Level</div>
          <Link className="qb-btn" style={{ display: "block", width: "100%", textAlign: "center" }} href="/student/assessments">
            Start Challenge →
          </Link>
        </div>
      </div>

      <div className="qb-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <div className="qb-card" style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "var(--color-primary-soft)", color: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px" }}>
            ✓
          </div>
          <div>
            <div style={{ fontSize: "0.875rem", color: "var(--color-text-muted)", fontWeight: 500 }}>Quizzes Completed</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-text)" }}>{data.stats.completed}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--color-success)", fontWeight: 600 }}>↑ +12 this week</div>
          </div>
        </div>
        <div className="qb-card" style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "rgba(236, 72, 153, 0.15)", color: "#ec4899", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px" }}>
            📊
          </div>
          <div>
            <div style={{ fontSize: "0.875rem", color: "var(--color-text-muted)", fontWeight: 500 }}>Average Score</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-text)" }}>{Math.round(data.stats.average)}%</div>
            <div style={{ fontSize: "0.75rem", color: "var(--color-success)", fontWeight: 600 }}>↑ +6% from last week</div>
          </div>
        </div>
        <div className="qb-card" style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "var(--color-warning-bg)", color: "var(--color-warning)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px" }}>
            🔥
          </div>
          <div>
            <div style={{ fontSize: "0.875rem", color: "var(--color-text-muted)", fontWeight: 500 }}>Current Streak</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-text)" }}>12 days</div>
            <div style={{ fontSize: "0.75rem", color: "var(--color-warning)", fontWeight: 600 }}>Keep it going!</div>
          </div>
        </div>
        <div className="qb-card" style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "rgba(251, 191, 36, 0.15)", color: "var(--color-gold)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px" }}>
            🏆
          </div>
          <div>
            <div style={{ fontSize: "0.875rem", color: "var(--color-text-muted)", fontWeight: 500 }}>Global Ranking</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-text)" }}>#{compData?.current_rank ?? "342"}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--color-success)", fontWeight: 600 }}>↑ Top 5% in Ghana</div>
          </div>
        </div>
      </div>

      <div className="qb-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: "24px" }}>
        <section className="qb-card" style={{ display: "flex", flexDirection: "column" }}>
          <h3 style={{ marginBottom: "24px" }}>Overall Mastery</h3>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1 }}>
            {data.stats.completed > 0 ? (
              <MasteryRing percentage={Math.round(data.stats.average)} label="Overall Mastery" size={180} color="var(--color-primary)" />
            ) : (
              <div className="qb-muted" style={{ padding: "32px 0" }}>Not enough data</div>
            )}
          </div>
        </section>

        <section className="qb-card">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
            <h3 style={{ margin: 0 }}>Subject Performance</h3>
            <a href="#" style={{ fontSize: "0.8125rem", color: "var(--color-primary)", fontWeight: 600 }}>View All →</a>
          </div>
          {subjectMastery.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {subjectMastery.slice(0, 4).map((sub) => (
                <div key={sub.name} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ width: "40px", height: "40px", borderRadius: "8px", background: "var(--color-primary-soft)", color: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    📚
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text)" }}>{sub.name}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{sub.percentage}% • SHS Level</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="qb-muted" style={{ padding: "32px 0" }}>Not enough data.</div>
          )}
        </section>
        
        <section className="qb-card">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
            <h3 style={{ margin: 0 }}>Challenge Leaderboard</h3>
            <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>This Month ▾</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {compData?.leaderboard && compData.leaderboard.length > 0 ? (
              compData.leaderboard.slice(0, 3).map((player: any, index: number) => {
                const colors = [
                  { color: "var(--color-gold)", bg: "rgba(251, 191, 36, 0.15)" },
                  { color: "var(--color-silver)", bg: "rgba(148, 163, 184, 0.15)" },
                  { color: "var(--color-bronze)", bg: "rgba(180, 83, 9, 0.15)" }
                ];
                const c = colors[index] ?? { color: "var(--color-text-muted)", bg: "var(--color-surface-muted)" };
                return (
                  <div key={player.id || index} style={{ display: "flex", alignItems: "center", gap: "12px", background: index === 1 ? "var(--color-surface-muted)" : "transparent", padding: index === 1 ? "8px" : "0", borderRadius: index === 1 ? "8px" : "0", margin: index === 1 ? "0 -8px" : "0" }}>
                    <span style={{ width: "24px", textAlign: "center", fontWeight: 700, color: c.color }}>{index + 1}</span>
                    <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "var(--color-surface-muted)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: "bold" }}>{player.name?.[0] || "?"}</div>
                    <div style={{ flex: 1, fontSize: "0.875rem", fontWeight: 600 }}>{player.name || "Unknown"}</div>
                    <div style={{ fontSize: "0.875rem", fontWeight: 700 }}>{player.score || 0} pts</div>
                  </div>
                );
              })
            ) : (
              <div className="qb-muted" style={{ padding: "16px 0", textAlign: "center" }}>No leaderboard data available.</div>
            )}
          </div>
        </section>
      </div>

      <div className="qb-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: "24px" }}>
        <section className="qb-card">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
            <h3 style={{ margin: 0 }}>Your Performance Trend</h3>
            <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>Last 8 Weeks ▾</span>
          </div>
          {trendData.length > 1 ? (
            <TrendChart data={trendData} height={200} yAxisLabel="Score %" />
          ) : (
            <div className="qb-muted" style={{ padding: "32px 0" }}>Complete at least 2 assessments.</div>
          )}
        </section>

        <section className="qb-card">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
            <h3 style={{ margin: 0 }}>Achievements & Badges</h3>
            <a href="#" style={{ fontSize: "0.8125rem", color: "var(--color-primary)", fontWeight: 600 }}>View All →</a>
          </div>
          <div className="qb-grid cols-2" style={{ gap: "16px" }}>
            {achievements.length > 0 ? achievements.slice(0, 4).map((ach) => (
              <AchievementBadge key={ach.id} type={ach.type.toLowerCase() === 'championship' ? 'championship' : 'mastery'} tier={ach.tier?.toLowerCase() || 'standard'} size="md" label={ach.title} />
            )) : (
              <div className="qb-muted" style={{ gridColumn: "span 2", textAlign: "center", padding: "32px 0" }}>No achievements yet</div>
            )}
          </div>
        </section>
        
        <section className="qb-card">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
            <h3 style={{ margin: 0 }}>Upcoming Assignments</h3>
            <a href="#" style={{ fontSize: "0.8125rem", color: "var(--color-primary)", fontWeight: 600 }}>View All →</a>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {data.assignments.length ? (
              data.assignments.slice(0, 3).map((row: any) => (
                <div key={row.id} style={{ display: "flex", alignItems: "center", gap: "12px", borderBottom: "1px solid var(--color-border)", paddingBottom: "12px" }}>
                  <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "var(--color-primary-soft)", color: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    📄
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text)" }}>{row.assignments?.title ?? "Assignment"}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{row.assignments?.subject_code ?? ""} • {row.assignments?.due_at ? `Due ${new Date(row.assignments.due_at).toLocaleDateString()}` : "No due date"}</div>
                  </div>
                  <button className="qb-btn ghost" style={{ padding: "4px 8px", fontSize: "0.75rem" }} onClick={async () => { const attempt: any = await startAttempt({ assessmentId: row.assignments.assessment_id, assignmentId: row.assignment_id, classId: row.class_id }); router.push(`/student/attempt/${attempt.attempt_id}`); }}>→</button>
                </div>
              ))
            ) : (
              <div className="qb-muted">No assignments yet.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
