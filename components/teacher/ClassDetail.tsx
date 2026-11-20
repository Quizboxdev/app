"use client";

import { useEffect, useState } from "react";
import { CLASS_NAME_MAX, listClassRoster, renameClass } from "@/lib/api/teacher";
import { formatDate } from "@/lib/format";

type Member = { id: string; student_name: string | null; student_email: string | null; joined_at: string | null; status: string | null };

// The detail view for one class on the teacher's Classes page: rename it and see who has joined.
export default function ClassDetail({ classId, name, onRenamed }: { classId: string; name: string; onRenamed: () => void | Promise<void> }) {
  const [members, setMembers] = useState<Member[] | null>(null), [error, setError] = useState(""), [value, setValue] = useState(name), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  useEffect(() => { let live = true; listClassRoster(classId).then((rows) => { if (live) setMembers(rows as Member[]); }).catch((e) => { if (live) { setMembers([]); setError(e.message); } }); return () => { live = false; }; }, [classId]);

  async function save() {
    setBusy(true); setError(""); setSaved(false);
    try { await renameClass(classId, value); setSaved(true); await onRenamed(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="qb-card" style={{ marginTop: 8 }} aria-label={`Details for ${name}`}>
      <div className="qb-field">
        <label htmlFor={`rename-${classId}`}>Class name</label>
        <div className="qb-actions">
          <input id={`rename-${classId}`} value={value} maxLength={CLASS_NAME_MAX} onChange={(e) => { setValue(e.target.value); setSaved(false); }} />
          <button className="qb-btn secondary" type="button" disabled={busy || !value.trim() || value.trim() === name} onClick={() => void save()}>{busy ? "Saving…" : "Rename"}</button>
        </div>
        <span className="qb-muted qb-small">{value.length}/{CLASS_NAME_MAX}</span>
        {saved && <p role="status">Name saved.</p>}
        {error && <p className="qb-error" role="alert">{error}</p>}
      </div>
      <h3>Learners ({members?.filter((m) => m.status !== "removed").length ?? "…"})</h3>
      {members === null ? <p className="qb-muted" role="status">Loading learners…</p> : members.length === 0 ? <p className="qb-muted">No learners have joined yet. Share the join code.</p> : (
        <ul className="qb-list">{members.map((m) => <li className="qb-row" key={m.id}><div className="qb-row-main"><strong>{m.student_name || "Learner"}</strong><span className="qb-muted qb-small">{m.joined_at ? `Joined ${formatDate(m.joined_at)}` : ""}{m.status && m.status !== "active" ? ` · ${m.status}` : ""}</span></div></li>)}</ul>
      )}
    </div>
  );
}
