"use client";

import { useEffect, useState } from "react";
import { applyAsReviewer, getMyApplication, type MyApplication } from "@/lib/api/reviewer-applications";
import { formatDate } from "@/lib/format";

const LEVELS = ["Primary", "JHS", "SHS"];

// A teacher's own card: apply to review content, see where the application stands, or re-apply after a decline. Shown on the teacher dashboard.
export default function ReviewerApplyCard() {
  const [app, setApp] = useState<MyApplication | null>(null);
  const [open, setOpen] = useState(false);
  const [quals, setQuals] = useState(""), [years, setYears] = useState("0"), [subjects, setSubjects] = useState(""), [levels, setLevels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [sent, setSent] = useState(false);
  useEffect(() => { getMyApplication().then(setApp).catch(() => setApp(null)); }, []);
  if (!app || app.status === "approved") return null;   // approved reviewers use the Reviews area; nothing to show here

  const canApply = app.status === "none" || app.status === "declined" || app.status === "pending";
  const waiting = app.status === "declined" && app.can_reapply_after && new Date(app.can_reapply_after) > new Date();
  const list = subjects.split(",").map((s) => s.trim()).filter(Boolean);
  async function submit() {
    setBusy(true); setError("");
    try { await applyAsReviewer({ qualifications: quals.trim(), years_experience: Math.max(0, Math.round(Number(years) || 0)), subjects: list, education_levels: levels }); setSent(true); setOpen(false); setApp(await getMyApplication()); }
    catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  return (
    <section className="qb-card" aria-labelledby="rv-title" style={{ marginTop: 16 }}>
      <h2 id="rv-title">Become a QuizBox reviewer</h2>
      {sent && <p role="status">Thank you. Your application was received and our team will look at it.</p>}
      {app.status === "none" && <p className="qb-muted">Experienced teachers can review questions for accuracy before learners see them. You choose the subjects; we check your details first.</p>}
      {app.status === "pending" && <p className="qb-muted">Your application is with our team. You will see a notification when there is a decision.{app.requested?.length ? ` Subjects: ${app.requested.map((r) => r.subject_code).join(", ")}.` : ""}</p>}
      {app.status === "declined" && <p className="qb-muted">Your last application was not approved{app.note ? `: ${app.note}` : "."} {waiting ? `You can apply again after ${formatDate(app.can_reapply_after!)}.` : "You can apply again now."}</p>}
      {app.status === "suspended" && <p className="qb-muted">Your reviewer access is currently paused. Please contact support.</p>}
      {error && <p className="qb-error" role="alert">{error}</p>}
      {canApply && !waiting && !open && <button className="qb-btn" onClick={() => { setOpen(true); setSent(false); if (app.status === "pending") { setQuals(app.qualifications ?? ""); setYears(String(app.years_experience ?? 0)); setSubjects((app.requested ?? []).map((r) => r.subject_code).join(", ")); } }}>{app.status === "pending" ? "Edit my application" : "Apply"}</button>}
      {open && <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
        <label>Subjects you can review (separate with commas, up to 6)<input className="qb-input" value={subjects} onChange={(e) => setSubjects(e.target.value)} placeholder="Mathematics, Science" style={{ width: "100%" }} /></label>
        <div className="qb-chip-row" role="group" aria-label="Levels you teach">{LEVELS.map((l) => <button key={l} type="button" className="qb-chip" aria-pressed={levels.includes(l)} onClick={() => setLevels(levels.includes(l) ? levels.filter((x) => x !== l) : [...levels, l].slice(0, 3))}>{l}</button>)}</div>
        <label>Qualifications and experience (at least 20 characters)<textarea className="qb-input" rows={3} value={quals} maxLength={2000} onChange={(e) => setQuals(e.target.value)} style={{ width: "100%" }} /></label>
        <label>Years of teaching experience<input className="qb-input" type="number" min={0} max={60} value={years} onChange={(e) => setYears(e.target.value)} style={{ width: 120 }} /></label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="qb-btn" disabled={busy || quals.trim().length < 20 || !list.length || list.length > 6} onClick={() => void submit()}>{busy ? "Sending…" : "Submit application"}</button>
          <button className="qb-btn secondary" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </div>}
    </section>
  );
}
