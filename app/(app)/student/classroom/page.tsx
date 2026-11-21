"use client";

import { FormEvent, useEffect, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import HelpLink from "@/components/help/HelpLink";
import { formatDateTime, isUuid } from "@/lib/format";
import { bootstrapUser } from "@/lib/auth";
import { getStudentClassCards, getStudentClassroom, joinClass, type ClassCard } from "@/lib/api/student";
import SourceChip from "@/components/SourceChip";
import { countBySource, filterBySource, type SourceFilter } from "@/lib/learning/work-source";

export default function StudentClassroomPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [studentId, setStudentId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [cards, setCards] = useState<Record<string, ClassCard>>({});

  async function refresh(id: string) {
    setData(await getStudentClassroom(id));
    setCards(await getStudentClassCards());
  }

  useEffect(() => {
    bootstrapUser()
      .then((ctx) => {
        const studentId = String((ctx.studentProfile as any)?.id ?? "");
        if (!studentId) throw new Error("Student profile not found.");
        setStudentId(studentId);
        return getStudentClassroom(studentId);
      })
      .then(setData)
      .then(() => getStudentClassCards().then(setCards))
      .catch((e) => setError(e.message));
  }, []);

  async function submitJoin(event: FormEvent) {
    event.preventDefault();
    setError(""); setNotice("");
    try {
      const result: any = await joinClass(joinCode);
      const already = (data?.memberships ?? []).some((m: any) => m.class_id === result.class_id && m.status === "active");
      setNotice(already ? `You are already in ${result.class_name}.` : `Joined ${result.class_name}.`);
      setJoinCode("");
      await refresh(studentId);
    } catch (reason: any) {
      setError(reason.message === "INVALID_CLASS_CODE" ? "That class code was not found." : reason.message);
    }
  }

  if (error && !data) return <div className="qb-card qb-error" role="alert">{error}</div>;
  if (!data) return <div className="qb-card qb-empty" aria-busy="true">Loading classroom…</div>;

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Assignments</h1>
          <p>Work from your teachers and the classes you have joined.</p>
        </div>
        <HelpLink slug="join-a-class" label="How to join a class" />
      </div>

      <form className="qb-card qb-form" onSubmit={submitJoin}>
        {error && <p className="qb-error" role="alert">{error}</p>}
        <h2>Join a class</h2>
        <div className="qb-actions">
          <input aria-label="Class join code" placeholder="QB7-X4T9" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} required />
          <button className="qb-btn" type="submit">Join class</button>
        </div>
        {notice && <p>{notice}</p>}
      </form>

      <div className="qb-grid cols-2">
        <div className="qb-card">
          <h2>My classes</h2>
          <div className="qb-list">
            {data.memberships.map((row: any) => (
              <div className="qb-row" key={row.id}>
                <div className="qb-row-main">
                  <strong>{row.classes?.class_name ?? "Class"}</strong>
                  <span>{[row.classes?.grade_label ?? row.classes?.grade ?? "Class", cards[row.class_id]?.teacher_name ? `Teacher: ${cards[row.class_id].teacher_name}` : null].filter(Boolean).join(" · ")}</span>
                  {cards[row.class_id] && <span className="qb-muted qb-small">{cards[row.class_id].learners} learner{cards[row.class_id].learners === 1 ? "" : "s"} · {cards[row.class_id].open_assignments} open assignment{cards[row.class_id].open_assignments === 1 ? "" : "s"}</span>}
                </div>
                <StatusBadge status={row.status} />
              </div>
            ))}
            {!data.memberships.length && (
              <div className="qb-empty"><strong>No classes yet</strong>Enter the join code your teacher gave you.</div>
            )}
          </div>
        </div>

        <div className="qb-card">
          <h2>Assignments</h2>
          {(() => { const n = countBySource<any>(data.assignments); return n.family > 0 ? <div className="qb-chip-row" role="group" aria-label="Show work from" style={{ marginBottom: 8 }}>
            {([["all", "All"], ["school", "School"], ["family", "Family"]] as const).map(([k, l]) => <button key={k} type="button" className="qb-chip" aria-pressed={source === k} onClick={() => setSource(k)}>{l} ({n[k]})</button>)}</div> : null; })()}
          <div className="qb-list">
            {filterBySource<any>(data.assignments, source).map((row: any) => (
              <div className="qb-row" key={row.id}>
                <div className="qb-row-main">
                  <strong>{row.title ?? "Assignment"}</strong><SourceChip row={row} />
                  <span>{[isUuid(row.subject_code) ? null : row.subject_code, row.due_at ? `Due ${formatDateTime(row.due_at)}` : "No due date"].filter(Boolean).join(" · ")}</span>
                </div>
              </div>
            ))}
            {!data.assignments.length && (
              <div className="qb-empty"><strong>No assignments yet</strong>Assignments from your classes appear here.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
