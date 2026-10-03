
"use client";

import { TeacherInsights } from "@/components/Insights";
import HomeSections from "@/components/HomeSections";
import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import { bootstrapUser } from "@/lib/auth";
import { getTeacherAnalytics, getTeacherDashboard, listIndicatorLearners, listIndicatorLearnersPage, publishAssignment } from "@/lib/api/teacher";
import { ChevronLeft, ChevronRight } from "lucide-react";
import MasteryRing from "@/components/charts/MasteryRing";
import MasteryBar from "@/components/charts/MasteryBar";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

export default function TeacherDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  
  const [drilldown, setDrilldown] = useState<any>(null);
  const [selectedLearners, setSelectedLearners] = useState<string[]>([]);
  const [remedial, setRemedial] = useState<any>(null);
  const [learnerPage, setLearnerPage] = useState(1);
  const [learnerTotal, setLearnerTotal] = useState(0);
  const [learnersLoading, setLearnersLoading] = useState(false);
  
  const classId = drilldown?.row.classId;
  const nodeId = drilldown?.row.curriculumNodeId;
  
  useEffect(() => { setLearnerPage(1); }, [classId, nodeId]);
  
  useEffect(() => {
    if(!classId || !nodeId) return;
    let current = true; setLearnersLoading(true);
    listIndicatorLearnersPage(classId, nodeId, learnerPage)
      .then(result => { if (current) { setLearnerTotal(result.total); setDrilldown((previous: any) => previous ? { ...previous, learners: result.rows } : previous); }})
      .catch(reason => { if (current) setError(reason.message); })
      .finally(() => { if (current) setLearnersLoading(false); });
    return () => { current = false; };
  }, [classId, nodeId, learnerPage]);

  useEffect(() => {
    bootstrapUser()
      .then((ctx) => {
        const teacherId = String((ctx.teacherProfile as any)?.id ?? "");
        if (!teacherId) throw new Error("Teacher profile not found.");
        return Promise.all([getTeacherDashboard(teacherId, ctx.userId), getTeacherAnalytics(teacherId)]);
      })
      .then(([dashboard, analytics]) => setData({ ...dashboard, analytics }))
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
            <div style={{ width: "40%", height: "20px", background: "var(--qb-surface-muted)", borderRadius: "4px" }} />
            <div style={{ width: "100%", height: "60px", background: "var(--qb-surface-muted)", borderRadius: "8px" }} />
          </div>
        ))}
      </div>
    </div>
  );

  const colors = ["#167a45", "#0b5fff", "#f59e0b", "#b42318"];

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Teacher Dashboard</h1>
          <p>Monitor class proficiency, resolve weak indicators, and manage assessments.</p>
        </div>
      </div>
      <HomeSections only={["summary","pending","submissions","weak","sme","earnings","qa"]}/>

      <div className="qb-grid cols-4" style={{ marginBottom: "24px" }}>
        <StatCard value={data.classes.length} label="Classes" />
        <StatCard value={data.assignments.length} label="Assignments" />
        <StatCard value={data.questionBanks.length} label="Question banks" />
        <StatCard value={data.gradebook.length} label="Gradebook records" />
      </div>

      {drilldown && (
        <nav className="qb-actions" aria-label="Affected learner pages" style={{ marginBottom: "16px" }}>
          <span>{learnerTotal} learners / page {learnerPage}</span>
          <button type="button" className="qb-btn ghost" disabled={learnersLoading || learnerPage === 1} onClick={() => setLearnerPage(p => p - 1)}><ChevronLeft size={18}/></button>
          <button type="button" className="qb-btn ghost" disabled={learnersLoading || learnerPage * 25 >= learnerTotal} onClick={() => setLearnerPage(p => p + 1)}><ChevronRight size={18}/></button>
        </nav>
      )}

      {/* Class Proficiency (Analytics) */}
      <div className="qb-grid cols-2" style={{ marginBottom: "24px" }}>
        {data.analytics.classes.length > 0 ? data.analytics.classes.map((cls: any) => (
          <div key={cls.id} className="qb-card" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2>{cls.class_name}</h2>
                <p className="qb-muted" style={{ margin: 0 }}>Class Proficiency Overview</p>
              </div>
            </div>
            
            <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
              <MasteryRing percentage={cls.average} label="Avg Score" size={120} />
              <div style={{ flex: 1, height: "140px" }}>
                {cls.bands.length > 0 && (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={cls.bands} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={50} innerRadius={35}>
                        {cls.bands.map((_: any, index: number) => <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: "var(--qb-surface)", borderRadius: "8px", border: "1px solid var(--qb-border)" }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
                <div style={{ fontSize: "0.875rem" }}><strong>Completion:</strong> {cls.completionRate}%</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {cls.bands.map((band: any, i: number) => (
                    <div key={band.label} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.75rem" }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: colors[i % colors.length] }} />
                      <span>{band.label} ({band.percentage}%)</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )) : (
          <div className="qb-card qb-muted" style={{ gridColumn: "span 2", textAlign: "center", padding: "40px" }}>
            Not enough data. No completed learner attempts yet.
          </div>
        )}
      </div>

      <div className="qb-grid cols-2" style={{ marginBottom: "24px" }}>
        <div className="qb-card">
          <h2>Weak Indicators</h2>
          {data.analytics.indicators.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "16px" }}>
              {data.analytics.indicators.slice(0, 5).map((row: any) => (
                <MasteryBar 
                  key={row.code} 
                  label={`${row.code} (${row.learnerCount} learners)`} 
                  percentage={row.averageAccuracy} 
                  color="var(--qb-warning)" 
                />
              ))}
            </div>
          ) : (
            <p className="qb-muted" style={{ padding: "16px 0" }}>No learning events yet.</p>
          )}
        </div>
        
        <div className="qb-card">
          <h2>Needs attention</h2>
          <div className="qb-list">
            {data.analytics.needsAttention.length > 0 ? data.analytics.needsAttention.map((row: any) => (
              <div className="qb-row" key={row.code}>
                <div className="qb-row-main">
                  <strong>{row.code}</strong>
                  <span>{row.title}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--qb-danger)" }}>{row.learnerCount} affected ({row.averageMastery}% mastery)</span>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button className="qb-btn ghost" type="button" onClick={async () => { try { const learners = await listIndicatorLearners(row.classId, row.curriculumNodeId); setDrilldown({ row, learners }); setSelectedLearners(learners.map((l: any) => l.student_user_id)); } catch (e: any) { setError(e.message); } }}>View learners</button>
                  </div>
                </div>
              </div>
            )) : (
              <p className="qb-muted" style={{ padding: "16px 0" }}>No indicators need attention.</p>
            )}
          </div>
        </div>
      </div>

      {drilldown && (
        <div className="qb-card" style={{ marginBottom: "24px", border: "1px solid var(--qb-primary-light)", backgroundColor: "var(--qb-surface-muted)" }}>
          <h2>Affected learners: {drilldown.row.code}</h2>
          <p className="qb-muted" style={{ margin: "4px 0 16px 0" }}>{selectedLearners.length} selected for remedial action.</p>
          
          <div className="qb-content-filters" style={{ marginBottom: "16px" }}>
            <button className="qb-btn ghost" type="button" onClick={() => setSelectedLearners(drilldown.learners.map((l: any) => l.student_user_id))}>Select all</button>
            <button className="qb-btn ghost" type="button" onClick={() => setSelectedLearners([])}>Clear selection</button>
            <button className="qb-btn" type="button" disabled={!selectedLearners.length} onClick={() => setRemedial({ title: `Remedial Practice: ${drilldown.row.code}`, instructions: "Practice this indicator again.", count: 5, minutes: 20, attempts: 1, preview: false })}>Create remedial practice</button>
          </div>
          
          <div className="qb-list">
            {drilldown.learners.map((learner: any) => (
              <label className="qb-row" key={learner.student_user_id} style={{ cursor: "pointer", border: selectedLearners.includes(learner.student_user_id) ? "1px solid var(--qb-primary)" : undefined }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <input type="checkbox" checked={selectedLearners.includes(learner.student_user_id)} onChange={() => setSelectedLearners((current) => current.includes(learner.student_user_id) ? current.filter((id) => id !== learner.student_user_id) : [...current, learner.student_user_id])} style={{ width: "20px", height: "20px" }} />
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <strong>{learner.student_name ?? learner.student_email}</strong>
                    <span className="qb-muted" style={{ fontSize: "0.75rem" }}>Latest {learner.latestScore}% · Mastery {learner.masteryScore}% · {learner.proficiencyState}</span>
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {remedial && drilldown && (
        <div className="qb-card" style={{ marginBottom: "24px" }}>
          <h2>Remedial Practice Setup</h2>
          <p className="qb-muted">{selectedLearners.length} selected learner(s) · {drilldown.row.code} · Practice mode</p>
          <div className="qb-form">
            <label>Title<input value={remedial.title} onChange={(event) => setRemedial({ ...remedial, title: event.target.value })} /></label>
            <label>Instructions<textarea value={remedial.instructions} onChange={(event) => setRemedial({ ...remedial, instructions: event.target.value })} /></label>
            <div className="qb-content-filters">
              <label>Question Count<input type="number" min="1" value={remedial.count} onChange={(event) => setRemedial({ ...remedial, count: Number(event.target.value) })} /></label>
              <label>Time Limit (minutes)<input type="number" min="1" value={remedial.minutes} onChange={(event) => setRemedial({ ...remedial, minutes: Number(event.target.value) })} /></label>
            </div>
            
            <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
              {!remedial.preview ? (
                <button className="qb-btn" type="button" onClick={() => setRemedial({ ...remedial, preview: true })}>Preview & Publish</button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%" }}>
                  <div className="qb-row" style={{ backgroundColor: "var(--qb-warning-bg)", color: "var(--qb-warning)", border: "none" }}>
                    Questions will be selected from approved easy and medium items for this indicator.
                  </div>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <button className="qb-btn ghost" type="button" onClick={() => setRemedial(null)}>Cancel</button>
                    <button className="qb-btn" type="button" onClick={async () => { try { await publishAssignment({ classId: drilldown.row.classId, title: remedial.title, description: remedial.instructions, curriculumNodeIds: [drilldown.row.curriculumNodeId], questionCount: remedial.count, difficulty: undefined, selectionMode: "AUTOMATIC", mode: "PRACTICE", attemptsAllowed: remedial.attempts, timeLimitMinutes: remedial.minutes, targetStudentIds: selectedLearners, remediationNodeId: drilldown.row.curriculumNodeId }); setRemedial(null); setError(""); } catch (reason: any) { setError(reason.message); } }}>Publish Remedial Practice</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="qb-grid cols-2">
        <div className="qb-card">
          <h2>Recent assignments</h2>
          <div className="qb-list">
            {data.assignments.length > 0 ? data.assignments.slice(0, 6).map((row: any) => (
              <div className="qb-row" key={row.id}>
                <div className="qb-row-main">
                  <strong>{row.title ?? "Assignment"}</strong>
                  <span>{row.subject_code ?? ""} · {row.status}</span>
                </div>
              </div>
            )) : (
              <div className="qb-muted">No assignments yet.</div>
            )}
          </div>
        </div>

        <div className="qb-card">
          <h2>Recent grades</h2>
          <div className="qb-list">
            {data.gradebook.length > 0 ? data.gradebook.slice(0, 6).map((row: any) => (
              <div className="qb-row" key={row.id}>
                <div className="qb-row-main">
                  <strong>{row.student_name ?? row.student_email ?? "Student"}</strong>
                  <span>{row.status ?? ""}</span>
                </div>
                <strong>{Math.round(Number(row.percentage ?? 0))}%</strong>
              </div>
            )) : (
              <div className="qb-muted">No grades yet.</div>
            )}
          </div>
        </div>
      </div>
      
      <TeacherInsights/>
    </>
  );
}
