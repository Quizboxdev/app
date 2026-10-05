"use client";
import { useState } from "react";
import { listClassMembers, type ClassMember, type SchoolClass } from "@/lib/api/school";

// Lazy per-class roster with the existing "transfer to another active class" action.
export default function SchoolClassMembers({ cls, targets, busy, onTransfer }: { cls: SchoolClass; targets: SchoolClass[]; busy: boolean; onTransfer: (member: ClassMember, toClassId: string) => void }) {
  const [members, setMembers] = useState<ClassMember[] | null>(null), [error, setError] = useState("");
  return <details onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && members === null) listClassMembers(cls.id).then(setMembers).catch((r) => setError(r.message)); }}>
    <summary className="qb-link">Learners &amp; transfers</summary>
    {error && <p className="qb-error" role="alert">{error}</p>}
    {members?.length === 0 && <p className="qb-muted qb-small">No active learners.</p>}
    {members?.map((m) => <div key={m.id} className="qb-small">{m.student_name}{" "}
      <label className="qb-sr-only" htmlFor={`m-${m.id}`}>Transfer {m.student_name}</label>
      <select id={`m-${m.id}`} defaultValue="" disabled={busy} onChange={(e) => e.target.value && onTransfer(m, e.target.value)}>
        <option value="">Transfer to…</option>{targets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>)}
  </details>;
}
