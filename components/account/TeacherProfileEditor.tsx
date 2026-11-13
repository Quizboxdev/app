"use client";

import { useCallback, useEffect, useState } from "react";
import { getTeacherProfileStatus, updateTeacherProfile, type ConfigOption, type TeacherProfileStatus } from "@/lib/api/markets";
import { userFacingError } from "@/lib/errors";

// A teacher edits their own name, school, subjects and grades taught. There is no count limit (the changes are kept in a history), so there is no caution step.
// The screen is hidden until the database says it is switched on. A teacher who belongs to a school's organisation sees the school as fixed.
export default function TeacherProfileEditor({ current, grades, subjects, onSaved }: { current: { full_name: string; school_name: string | null; subjects: string[]; grade_codes: string[] }; grades: ConfigOption[]; subjects: ConfigOption[]; onSaved: () => void }) {
  const [status, setStatus] = useState<TeacherProfileStatus | null>(null), [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [name, setName] = useState(""), [school, setSchool] = useState(""), [pickedSubjects, setPickedSubjects] = useState<string[]>([]), [pickedGrades, setPickedGrades] = useState<string[]>([]);
  const refresh = useCallback(() => getTeacherProfileStatus().then(setStatus).catch(() => setStatus(null)), []);
  useEffect(() => { void refresh(); }, [refresh]);

  if (!status?.enabled || !status.eligible) return null;

  function begin() { setNotice(""); setError(""); setName(current.full_name); setSchool(current.school_name ?? ""); setPickedSubjects(current.subjects); setPickedGrades(current.grade_codes); setEditing(true); }
  async function save() {
    setBusy(true); setError("");
    try {
      const r = await updateTeacherProfile({ name, school: status?.school_locked ? null : school, subjects: pickedSubjects, grades: pickedGrades });
      setStatus(r); setEditing(false); setNotice("Saved. Your details are updated."); onSaved();
    } catch (cause) { setError(userFacingError(cause)); }
    setBusy(false);
  }
  const toggle = (set: (fn: (p: string[]) => string[]) => void, code: string) => set((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      {!editing && <div>
        <button type="button" className="qb-btn secondary" onClick={begin}>Edit profile</button>
        <p className="qb-muted qb-small" style={{ margin: "0.5rem 0 0" }}>Change your name, school, subjects and the grades you teach. Each change is recorded.</p>
      </div>}
      {notice && <p role="status" className="qb-success" style={{ margin: 0 }}>{notice}</p>}
      {editing && (
        <form className="qb-form" style={{ gap: "1rem" }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="qb-field"><label htmlFor="teacher-name">Full name</label><input id="teacher-name" value={name} maxLength={150} required onChange={(e) => setName(e.target.value)} /></div>
          <div className="qb-field">
            <label htmlFor="teacher-school">School</label>
            <input id="teacher-school" value={school} maxLength={200} required disabled={status.school_locked} onChange={(e) => setSchool(e.target.value)} />
            {status.school_locked && <span className="qb-muted qb-small">Set by your school&apos;s QuizBox administrator.</span>}
          </div>
          {subjects.length > 0 && <fieldset className="qb-field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ marginBottom: 6, padding: 0, fontSize: 13, fontWeight: 600, color: "var(--qb-text-primary)" }}>Subjects you teach</legend>
            <div style={{ display: "flex", gap: "0.5rem 1rem", flexWrap: "wrap" }}>
              {subjects.map((s) => <label key={s.code} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={pickedSubjects.includes(s.code)} onChange={() => toggle(setPickedSubjects, s.code)} />{s.label}</label>)}
            </div>
          </fieldset>}
          {grades.length > 0 && <fieldset className="qb-field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ marginBottom: 6, padding: 0, fontSize: 13, fontWeight: 600, color: "var(--qb-text-primary)" }}>Grades you teach</legend>
            <div style={{ display: "flex", gap: "0.5rem 1rem", flexWrap: "wrap" }}>
              {grades.map((g) => <label key={g.code} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={pickedGrades.includes(g.code)} onChange={() => toggle(setPickedGrades, g.code)} />{g.label}</label>)}
            </div>
          </fieldset>}
          {error && <p className="qb-error" role="alert" style={{ margin: 0 }}>{error}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="qb-btn" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
            <button type="button" className="qb-btn ghost" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
