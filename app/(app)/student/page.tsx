"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { bootstrapUser } from "@/lib/auth";
import { getStudentDashboard, getStudentCompetitionAnalytics, getStudentAchievements } from "@/lib/api/student";
import { startAttempt } from "@/lib/api/assessment";
import MasteryRing from "@/components/charts/MasteryRing";
import TrendChart from "@/components/charts/TrendChart";
import { Calendar, CheckCircle, BarChart2, Flame, Trophy, BookOpen, FileText, ChevronDown, ArrowRight } from 'lucide-react';
import AchievementBadge from "@/components/achievements/AchievementBadge";

function sanitizeLabel(label: string): string {
  if (!label) return "";
  const clean = label.replace(/DEV_FACTORY_PILOT|snapshot|dev_|test_|fixture_/gi, '').trim();
  if (clean.length === 0) return "General Assessment";
  const subjectMap: Record<string, string> = { 'MATH': 'Mathematics', 'SCI': 'Science', 'ENG': 'English', 'COMP': 'Computing' };
  return subjectMap[clean.toUpperCase()] || clean;
}

export default function StudentDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [compData, setCompData] = useState<any>(null);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [studentName, setStudentName] = useState("");

  useEffect(() => {
    bootstrapUser().then(async (ctx) => {
      const studentId = String((ctx.studentProfile as any)?.id ?? "");
      if (!studentId) throw new Error("Student profile not found.");
      setStudentName(String((ctx.profile as any)?.full_name ?? "Student").split(" ")[0]);
      const [dash, comp, ach] = await Promise.all([
        getStudentDashboard(studentId),
        getStudentCompetitionAnalytics(studentId).catch(() => null),
        getStudentAchievements(studentId).catch(() => [])
      ]);
      setData(dash); setCompData(comp); setAchievements(ach);
    }).catch((e) => setError(e.message)).finally(() => setBusy(false));
  }, []);

  if (error) return <div className="qb-card qb-error" style={{ margin: "24px" }}>{error}</div>;
  if (busy) return <div className="qb-container" aria-busy="true" style={{ paddingTop: "24px" }}>Loading...</div>;

  const subjects: Record<string, { total: number; count: number }> = {};
  (data.results ?? []).forEach((row: any) => {
    const code = sanitizeLabel(row.subject_code ?? "General");
    if (!subjects[code]) subjects[code] = { total: 0, count: 0 };
    subjects[code].total += Number(row.percentage ?? 0);
    subjects[code].count += 1;
  });
  const subjectMastery = Object.entries(subjects).map(([name, val]) => ({
    name, percentage: Math.round(val.total / val.count)
  }));

  const trendData = [...(data.results ?? [])].reverse().map((r: any, idx) => ({
    name: r.submitted_at ? new Date(r.submitted_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : `Attempt ${idx + 1}`,
    score: Math.round(Number(r.percentage ?? 0))
  }));

  return (
    <div className="qb-container" style={{ paddingBottom: "48px" }}>
      <div style={{ marginBottom: "24px", paddingTop: "24px" }}>
        <h1 style={{ fontSize: "30px", fontWeight: 700, margin: "0 0 4px 0", color: "var(--color-text)" }}>Student Dashboard</h1>
        <p style={{ fontSize: "14px", color: "var(--color-text-muted)", margin: 0 }}>Track your progress, take on new challenges and keep growing.</p>
      </div>

      <div style={{
          height: "210px",
          borderRadius: "16px",
          background: "linear-gradient(135deg, var(--color-primary-soft) 0%, #dbeafe 100%)",
          padding: "24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px"
        }}>
        <div style={{ flex: "0 0 60%" }}>
          <div style={{ color: "var(--color-text-muted)", fontSize: "14px", marginBottom: "4px" }}>Good morning,</div>
          <h2 style={{ fontSize: "28px", fontWeight: 800, margin: "0 0 12px 0", color: "var(--color-text)" }}>{studentName}!</h2>
          <p style={{ color: "var(--color-text-muted)", margin: 0, fontSize: "14px", maxWidth: "400px", lineHeight: 1.5 }}>
            Consistency today builds the results you want tomorrow.<br/>Keep the momentum going!
          </p>
        </div>
        <div style={{ background: "var(--color-surface)", padding: "20px", borderRadius: "14px", boxShadow: "var(--shadow-md)", width: "320px" }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)", padding: "4px 8px", borderRadius: "8px", fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}><Calendar size={14} /> Upcoming Challenge</span>
          </div>
          <strong style={{ display: "block", fontSize: "16px", marginBottom: "4px", color: "var(--color-text)", fontWeight: 600 }}>Mathematics Mastery</strong>
          <div style={{ color: "var(--color-text-muted)", fontSize: "12px", marginBottom: "16px" }}>30 questions &bull; 20 mins &bull; SHS Level</div>
          <Link className="qb-btn" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "42px", borderRadius: "10px", fontSize: "14px" }} href="/student/assessments">
            Start Challenge <ArrowRight size={16} style={{ marginLeft: "6px" }} />
          </Link>
        </div>
      </div>

      <div className="qb-grid" style={{ gap: "14px", marginBottom: "20px" }}>
        <div className="qb-card col-3" style={{ padding: "18px" }}>
          <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 700 }}>Quizzes Completed</span>
          <b style={{ fontSize: "28px", display: "block", marginTop: "5px", color: "var(--ink)" }}>{data.stats.completed}</b>
        </div>
        <div className="qb-card col-3" style={{ padding: "18px" }}>
          <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 700 }}>Average Score</span>
          <b style={{ fontSize: "28px", display: "block", marginTop: "5px", color: "var(--ink)" }}>{Math.round(data.stats.average)}%</b>
        </div>
        <div className="qb-card col-3" style={{ padding: "18px" }}>
          <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 700 }}>Current Streak</span>
          <b style={{ fontSize: "28px", display: "block", marginTop: "5px", color: "var(--ink)" }}>12 days</b>
        </div>
        <div className="qb-card col-3" style={{ padding: "18px" }}>
          <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 700 }}>Global Ranking</span>
          <b style={{ fontSize: "28px", display: "block", marginTop: "5px", color: "var(--ink)" }}>#{compData?.current_rank ?? "342"}</b>
        </div>
      </div>
      <div className="qb-grid">
        <section className="qb-card qb-panel col-4" style={{ minHeight: "300px", display: "flex", flexDirection: "column" }}>
          <h3 style={{ fontSize: "16px", fontWeight: 600, margin: "0 0 24px 0", color: "var(--color-text)" }}>Overall Mastery</h3>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1 }}>
            {data.stats.completed > 0 ? (
              <MasteryRing percentage={Math.round(data.stats.average)} label="Overall Mastery" size={160} color="var(--color-primary)" />
            ) : (
              <div style={{ color: "var(--color-text-muted)" }}>Not enough data</div>
            )}
          </div>
        </section>

        <section className="qb-card qb-panel col-4" style={{ minHeight: "300px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, margin: 0, color: "var(--color-text)" }}>Subject Performance</h3>
            <a href="#" style={{ fontSize: "13px", color: "var(--color-primary)", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}>View All <ArrowRight size={14} /></a>
          </div>
          {subjectMastery.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {subjectMastery.slice(0, 4).map((sub) => (
                <div key={sub.name} style={{ background: "var(--color-surface-muted)", borderRadius: "10px", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <BookOpen size={16} color="var(--color-primary)" />
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub.name}</span>
                  </div>
                  <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text)" }}>{sub.percentage}%</div>
                  <div style={{ height: "4px", background: "#e2e8f0", borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${sub.percentage}%`, background: "var(--color-primary)" }}></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: "var(--color-text-muted)", padding: "32px 0" }}>Not enough data.</div>
          )}
        </section>
        
        <section className="qb-card qb-panel col-4" style={{ minHeight: "300px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, margin: 0, color: "var(--color-text)" }}>Challenge Leaderboard</h3>
            <span style={{ fontSize: "13px", color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>This Month <ChevronDown size={14} /></span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {compData?.leaderboard && compData.leaderboard.length > 0 ? (
              compData.leaderboard.slice(0, 3).map((player: any, index: number) => {
                const colors = [
                  { color: "var(--color-gold)", bg: "rgba(251, 191, 36, 0.15)" },
                  { color: "var(--color-silver)", bg: "rgba(148, 163, 184, 0.15)" },
                  { color: "var(--color-bronze)", bg: "rgba(180, 83, 9, 0.15)" }
                ];
                const c = colors[index] ?? { color: "var(--color-text-muted)", bg: "var(--color-surface-muted)" };
                return (
                  <div key={player.id || index} style={{ display: "flex", alignItems: "center", gap: "12px", background: index === 0 ? "var(--color-surface-muted)" : "transparent", padding: index === 0 ? "8px" : "4px 8px", borderRadius: "10px", margin: "0 -8px" }}>
                    <span style={{ width: "24px", textAlign: "center", fontWeight: 700, color: c.color }}>{index + 1}</span>
                    <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "var(--color-background)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "bold", color: "var(--color-text)" }}>{player.name?.[0] || "?"}</div>
                    <div style={{ flex: 1, fontSize: "14px", fontWeight: 600, color: "var(--color-text)" }}>{sanitizeLabel(player.name || "Unknown")}</div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text)" }}>{player.score || 0}</div>
                  </div>
                );
              })
            ) : (
              <div style={{ color: "var(--color-text-muted)", padding: "32px 0", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                <Trophy size={32} color="var(--color-border)" />
                <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text)" }}>No rankings yet</div>
                <div style={{ fontSize: "13px" }}>Complete a ranked challenge.</div>
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="qb-grid">
        <section className="qb-card qb-panel col-4" style={{ minHeight: "300px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, margin: 0, color: "var(--color-text)" }}>Performance Trend</h3>
            <span style={{ fontSize: "13px", color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>Last 8 Weeks <ChevronDown size={14} /></span>
          </div>
          {trendData.length > 1 ? (
            <div style={{ background: "transparent" }}>
               <TrendChart data={trendData} height={200} yAxisLabel="Score %" />
            </div>
          ) : (
            <div style={{ color: "var(--color-text-muted)", padding: "32px 0" }}>Complete at least 2 assessments.</div>
          )}
        </section>

        <section className="qb-card qb-panel col-4" style={{ minHeight: "300px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, margin: 0, color: "var(--color-text)" }}>Achievements</h3>
            <a href="#" style={{ fontSize: "13px", color: "var(--color-primary)", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}>View All <ArrowRight size={14} /></a>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            {achievements.length > 0 ? achievements.slice(0, 4).map((ach) => (
              <div key={ach.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "8px" }}>
                <AchievementBadge type={ach.type.toLowerCase() === 'championship' ? 'championship' : 'mastery'} tier={ach.tier?.toLowerCase() || 'standard'} size="md" label="" />
                <div>
                   <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text)" }}>{sanitizeLabel(ach.title)}</div>
                   <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Badge unlocked</div>
                </div>
              </div>
            )) : (
              <div style={{ gridColumn: "span 2", textAlign: "center", padding: "32px 0", color: "var(--color-text-muted)" }}>No achievements yet</div>
            )}
          </div>
        </section>
        
        <section className="qb-card qb-panel col-4" style={{ minHeight: "300px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, margin: 0, color: "var(--color-text)" }}>Upcoming Assignments</h3>
            <a href="#" style={{ fontSize: "13px", color: "var(--color-primary)", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}>View All <ArrowRight size={14} /></a>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {data.assignments.length ? (
              data.assignments.slice(0, 4).map((row: any) => (
                <div key={row.id} style={{ display: "flex", alignItems: "center", gap: "12px", borderBottom: "1px solid var(--color-border)", paddingBottom: "12px" }}>
                  <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "var(--color-primary-soft)", color: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <FileText size={18} />
                  </div>
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sanitizeLabel(row.assignments?.title ?? "Assignment")}</div>
                    <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>{sanitizeLabel(row.assignments?.subject_code ?? "")} &bull; {row.assignments?.due_at ? `Due ${new Date(row.assignments.due_at).toLocaleDateString()}` : "No due date"}</div>
                  </div>
                  <button className="qb-btn ghost" style={{ padding: "6px", fontSize: "12px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={async () => { const attempt: any = await startAttempt({ assessmentId: row.assignments.assessment_id, assignmentId: row.assignment_id, classId: row.class_id }); router.push(`/student/attempt/${attempt.attempt_id}`); }}>
                    <ArrowRight size={16} color="var(--color-text)" />
                  </button>
                </div>
              ))
            ) : (
              <div style={{ color: "var(--color-text-muted)", padding: "32px 0", textAlign: "center" }}>No assignments yet.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}



