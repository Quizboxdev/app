
"use client";

import { TeacherInsights } from "@/components/Insights";
import { humanize, isUuid, formatDate } from "@/lib/format";
import HomeSections from "@/components/HomeSections";
import { useEffect, useState } from "react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import AttentionList from "@/components/AttentionList";
import ProgressCard from "@/components/ProgressCard";
import { assignmentPhase, buildAttentionQueue } from "@/lib/learning/analytics";
import { classifyProficiency } from "@/lib/learning/proficiency";
import DashboardHero from "@/components/DashboardHero";
import { bootstrapUser } from "@/lib/auth";
import { getTeacherAnalytics, getTeacherDashboard, listIndicatorLearners, listIndicatorLearnersPage, publishAssignment } from "@/lib/api/teacher";
import { ChevronLeft, ChevronRight } from "lucide-react";
import MasteryBar from "@/components/charts/MasteryBar";

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
        return Promise.all([getTeacherDashboard(teacherId, ctx.userId), getTeacherAnalytics(teacherId), String((ctx.profile as any)?.full_name ?? "")]);
      })
      .then(([dashboard, analytics, name]) => setData({ ...dashboard, analytics, name }))
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, []);

  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (busy) return <div className="qb-home-grid" aria-busy="true">{[1, 2, 3].map((i) => <div key={i} className="qb-card qb-skeleton" />)}</div>;

  const now = Date.now();
  const analyticsClasses: any[] = data.analytics.classes;
  const phases = (["Active", "Scheduled", "Draft", "Closed"] as const).map((phase) => ({ phase, rows: data.assignments.filter((row: any) => assignmentPhase(row, now) === phase) }));
  const upcoming = [...phases[0].rows, ...phases[1].rows].sort((a: any, b: any) => (Date.parse(a.due_at ?? "") || Infinity) - (Date.parse(b.due_at ?? "") || Infinity)).slice(0, 5);
  const queue = buildAttentionQueue({ assignments: data.assignments, classes: analyticsClasses, needsAttention: data.analytics.needsAttention, now });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = String(data.name ?? "").trim().split(/\s+/)[0];
  const openIndicator = async (row: any) => {
    try { const learners = await listIndicatorLearners(row.classId, row.curriculumNodeId); setDrilldown({ row, learners }); setSelectedLearners(learners.map((l: any) => l.student_user_id)); } catch (e: any) { setError(e.message); }
  };

  return (
    <>
      <DashboardHero eyebrow="Teacher workspace" title={`${greeting}${firstName ? `, ${firstName}` : ""}`} description={`${data.classes.length} class${data.classes.length === 1 ? "" : "es"} · ${phases[0].rows.length} active assignment${phases[0].rows.length === 1 ? "" : "s"} · ${data.questionBanks.length} question bank${data.questionBanks.length === 1 ? "" : "s"}`} primary={{ label: "Create assignment", href: "/teacher/assignments" }} secondary={{ label: "Question bank", href: "/teacher/question-banks" }} />

      <section className="qb-card" aria-labelledby="th-attention">
        <h2 id="th-attention">Needs your attention</h2>
        <AttentionList items={queue} labels={{ danger: "Act", warning: "Soon", info: "Soon" }} empty={{ title: "Nothing urgent", detail: "Due dates, low completion and weak indicators appear here when they need you." }}
          renderAction={(item) => item.indicator ? <button type="button" className="qb-btn secondary" onClick={() => { const row = data.analytics.needsAttention.find((r: any) => r.code === item.indicator!.code && r.classId === item.indicator!.classId); if (row) void openIndicator(row); }}>View learners</button> : null} />
        <div className="qb-actions" style={{ marginTop: 12 }}>
          <Link className="qb-btn ghost" href="/teacher/classes">Classes</Link>
          <Link className="qb-btn ghost" href="/teacher/gradebook">Results</Link>
        </div>
      </section>

      <section className="qb-card" style={{ marginTop: 16 }} aria-labelledby="th-classes">
        <div className="qb-page-head"><h2 id="th-classes">Class performance</h2><Link className="qb-link" href="/teacher/classes">All classes</Link></div>
        {analyticsClasses.length ? <div className="qb-subject-list">{analyticsClasses.map((cls: any) => {
          const band = classifyProficiency(Number(cls.average));
          const top = [...cls.bands].sort((x: any, y: any) => y.count - x.count)[0];
          return <ProgressCard key={cls.id} name={cls.class_name} percentage={Number(cls.average)} badge={<StatusBadge status={band} label={band} tone={Number(cls.average) >= 68 ? "success" : Number(cls.average) >= 40 ? "warning" : "danger"} />}
            detail={`${cls.completionRate}% completion${top?.count ? ` · most learners ${top.label}` : ""}`} href="/teacher/gradebook" action="Results" />;
        })}</div> : <div className="qb-empty"><strong>No class results yet</strong>Class averages appear after learners complete an assessment.</div>}
      </section>

      <section className="qb-card" style={{ marginTop: 16 }} aria-labelledby="th-assignments">
        <div className="qb-page-head"><h2 id="th-assignments">Assignments</h2><Link className="qb-link" href="/teacher/assignments">Manage</Link></div>
        <p className="qb-level-legend">{phases.map(({ phase, rows }) => <span key={phase}>{phase}: <strong>{rows.length}</strong></span>)}</p>
        {upcoming.length ? <ul className="qb-task-list">{upcoming.map((row: any) => <li key={row.id}>
          <div className="qb-row-main"><strong>{row.title ?? "Assignment"}</strong><span>{[isUuid(row.subject_code) ? null : row.subject_code, row.due_at ? `Due ${formatDate(row.due_at)}` : "No due date"].filter(Boolean).join(" · ")}</span></div>
          <StatusBadge status={assignmentPhase(row, now)} />
        </li>)}</ul> : <div className="qb-empty"><strong>Nothing scheduled or active</strong>Create an assignment to give your class work.</div>}
      </section>

      <div style={{ marginTop: 16 }}><HomeSections only={["summary","pending","submissions","weak","sme","earnings","qa"]}/></div>

      {drilldown && (
        <nav className="qb-actions" aria-label="Affected learner pages" style={{ margin: "16px 0" }}>
          <span>{learnerTotal} learners / page {learnerPage}</span>
          <button type="button" className="qb-btn ghost" disabled={learnersLoading || learnerPage === 1} onClick={() => setLearnerPage(p => p - 1)}><ChevronLeft size={18}/></button>
          <button type="button" className="qb-btn ghost" disabled={learnersLoading || learnerPage * 25 >= learnerTotal} onClick={() => setLearnerPage(p => p + 1)}><ChevronRight size={18}/></button>
        </nav>
      )}

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
                    <button className="qb-btn ghost" type="button" onClick={() => void openIndicator(row)}>View learners</button>
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
                  <span>{[isUuid(row.subject_code) ? null : row.subject_code, humanize(row.status)].filter(Boolean).join(" · ")}</span>
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
