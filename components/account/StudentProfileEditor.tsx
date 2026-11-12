"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getProfileEditStatus, updateStudentProfile, type ConfigOption, type ProfileEditStatus } from "@/lib/api/markets";
import { userFacingError } from "@/lib/errors";

// A learner edits their own class level, school and subjects, twice in any six months. Pressing Edit first shows a caution about that limit; the form opens only after the learner says OK.
// Cancelling, or saving nothing, costs no edit. After a save the learner is told how many edits are left, or when the next one opens.
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "");
const edits = (n: number) => `${n} edit${n === 1 ? "" : "s"}`;

export default function StudentProfileEditor({ current, grades, subjects, onSaved }: { current: { grade_code: string | null; school_name: string | null; subjects: string[] }; grades: ConfigOption[]; subjects: ConfigOption[]; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<ProfileEditStatus | null>(null), [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [grade, setGrade] = useState(""), [school, setSchool] = useState(""), [picked, setPicked] = useState<string[]>([]);
  const refresh = useCallback(() => getProfileEditStatus().then(setStatus).catch(() => setStatus(null)), []);
  useEffect(() => { void refresh(); }, [refresh]);

  if (!status?.eligible) return status?.reason === "MANAGED_ACCOUNT" ? <p className="qb-muted qb-small">A teacher or guardian manages this account, so they change these details for you.</p> : null;
  const none = status.remaining <= 0;

  function begin() { setNotice(""); setError(""); dialog.current?.showModal(); }
  function accept() {
    dialog.current?.close(); setGrade(current.grade_code ?? ""); setSchool(current.school_name ?? ""); setPicked(current.subjects); setEditing(true);
  }
  async function save() {
    setBusy(true); setError("");
    try {
      const r = await updateStudentProfile({ grade: grade && grade !== current.grade_code ? grade : null, school, subjects: picked });
      setStatus(r); setEditing(false);
      setNotice(r.remaining > 0 ? `Saved. You have ${edits(r.remaining)} left in the next ${r.window_months} months.` : `Saved. That was your last edit for now. You can edit again from ${day(r.next_edit_at)}.`);
      onSaved();
    } catch (cause) { setError(userFacingError(cause)); await refresh(); }
    setBusy(false);
  }
  const toggle = (code: string) => setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      {!editing && <div>
        <button type="button" className="qb-btn secondary" disabled={none} onClick={begin}>Edit profile</button>
        <p className="qb-muted qb-small" style={{ margin: "0.5rem 0 0" }}>{none ? `You have used your ${edits(status.limit)}. You can edit again from ${day(status.next_edit_at)}.` : `You can edit your class level, school and subjects ${status.limit} times in ${status.window_months} months. You have ${edits(status.remaining)} left.`}</p>
      </div>}
      {notice && <p role="status" className="qb-success" style={{ margin: 0 }}>{notice}</p>}

      <dialog ref={dialog} className="qb-dialog" aria-labelledby="qb-edit-caution-title">
        <div className="qb-dialog-body">
          <h2 id="qb-edit-caution-title" style={{ margin: 0, fontSize: "1.125rem" }}>Before you edit</h2>
          <p style={{ margin: 0 }}>You can change your profile details only <strong>{status.limit} times in {status.window_months} months</strong>. This change will use one of your edits, so you will have <strong>{edits(Math.max(0, status.remaining - 1))}</strong> left afterwards.</p>
          <p className="qb-muted qb-small" style={{ margin: 0 }}>Your results and the classes you have already joined stay as they are. Practice and new challenges follow your new class level, so only change it if it is wrong. Closing this box without saving does not use an edit.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" className="qb-btn ghost" onClick={() => dialog.current?.close()}>Cancel</button>
            <button type="button" className="qb-btn" autoFocus onClick={accept}>OK, I understand</button>
          </div>
        </div>
      </dialog>

      {editing && (
        <form className="qb-form" style={{ gap: "1rem" }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
          {grades.length > 0 && <div className="qb-field">
            <label htmlFor="profile-grade">Class level</label>
            <select id="profile-grade" value={grade} onChange={(e) => setGrade(e.target.value)}>
              {!grades.some((g) => g.code === grade) && <option value={grade}>{grade || "Select class level"}</option>}
              {grades.map((g) => <option key={g.code} value={g.code}>{g.label}</option>)}
            </select>
          </div>}
          <div className="qb-field">
            <label htmlFor="profile-school">School</label>
            <input id="profile-school" value={school} maxLength={200} onChange={(e) => setSchool(e.target.value)} placeholder="Your school (optional)" />
          </div>
          {subjects.length > 0 && <fieldset className="qb-field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ marginBottom: 6, padding: 0, fontSize: 13, fontWeight: 600, color: "var(--qb-text-primary)" }}>Subjects</legend>
            <div style={{ display: "flex", gap: "0.5rem 1rem", flexWrap: "wrap" }}>
              {subjects.map((s) => <label key={s.code} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={picked.includes(s.code)} onChange={() => toggle(s.code)} />{s.label}</label>)}
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
