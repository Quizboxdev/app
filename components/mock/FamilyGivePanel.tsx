"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { familyGive, familyGiven, familyRevoke, type Exam, type FamilyGift } from "@/lib/api/mock-exams";
import { listFamilyChildren, type FamilyChild } from "@/lib/api/family";
import { formatDateTime } from "@/lib/format";
import { gradeLabel } from "@/lib/mock-exams/grades";

// Giving the exam to the children in the sponsor's family workspace: free, each child gets their own private copy for 90 days and finds it under My mock exams. Only children the sponsor may assign work to are offered.
export default function FamilyGivePanel({ exam, disabled }: { exam: Exam; disabled: boolean }) {
  const [kids, setKids] = useState<FamilyChild[] | null>(null), [given, setGiven] = useState<FamilyGift[] | null>(null), [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [done, setDone] = useState("");
  const load = useCallback(() => {
    listFamilyChildren().then((c) => setKids(c.filter((k) => k.status === "active" && k.student_id && k.permissions?.assign))).catch(() => setKids([]));
    familyGiven(exam.id).then(setGiven).catch(() => setGiven([]));
  }, [exam.id]);
  useEffect(() => { load(); }, [load]);
  const haveIt = new Set((given ?? []).filter((g) => g.active).map((g) => g.student_id)), pick = (kids ?? []).filter((k) => !haveIt.has(k.student_id as string));
  const toggle = (id: string) => setTicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function give() {
    setBusy("give"); setError(""); setDone("");
    try { const r = await familyGive(exam.id, [...ticked]); setDone(`Given to ${r.given} ${r.given === 1 ? "child" : "children"}. They find it under My mock exams for ${r.days} days.`); setTicked(new Set()); load(); } catch (e) { setError((e as Error).message); }
    setBusy("");
  }
  async function takeBack(g: FamilyGift) {
    if (!window.confirm(`Take this exam back from ${g.name}? They can no longer start it. What they have answered stays.`)) return;
    setBusy(g.grant_id); setError(""); setDone("");
    try { await familyRevoke(exam.id, g.student_id); setDone(`Taken back from ${g.name}.`); load(); } catch (e) { setError((e as Error).message); }
    setBusy("");
  }
  return (
    <section className="qb-card qb-form" aria-label="Give to my family">
      <h2 style={{ margin: 0 }}>Give to my family</h2>
      <p className="qb-muted qb-small" style={{ margin: 0 }}>Free. Each child gets their own private copy of version {exam.current_version_no} and finds it under My mock exams for 90 days. Marking, time limit and attempts are the usual ones.</p>
      {error && <p className="qb-error" role="alert">{error}</p>}{done && <p className="qb-ok" role="status">{done}</p>}
      {kids === null ? <p className="qb-muted">Loading…</p> : !kids.length ? <p className="qb-muted">No child in your family can be given work yet. <Link className="qb-link" href="/family">Open your family workspace</Link> to add or link a child.</p> :
        !pick.length ? <p className="qb-muted">Every child in your family already has this exam.</p> :
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 6 }}><legend className="qb-small qb-muted">Choose children</legend>
          {pick.map((k) => <label key={k.student_id as string} style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={ticked.has(k.student_id as string)} onChange={() => toggle(k.student_id as string)} disabled={disabled} />
            <span>{k.full_name ?? "Child"}{k.grade_code ? ` · ${gradeLabel(k.grade_code)}` : ""}</span></label>)}</fieldset>}
      {!!pick.length && <div><button className="qb-btn" disabled={!!busy || disabled || !ticked.size} onClick={() => void give()}>{busy === "give" ? "Giving…" : ticked.size ? `Give to ${ticked.size} ${ticked.size === 1 ? "child" : "children"}` : "Choose a child"}</button></div>}
      {!!given?.length && <><h3 style={{ margin: "8px 0 0" }}>Given so far</h3>
        <ul className="qb-list">{given.map((g) => <li key={g.grant_id}>{g.name} · version {g.version_no} · {g.active ? `until ${formatDateTime(g.expires_at)}` : g.status === "revoked" ? "taken back" : "ended"} · {g.attempts_used} {g.attempts_used === 1 ? "attempt" : "attempts"}{g.last_percent != null ? ` · last result ${g.last_percent}%` : ""}
          {g.active && <> · <button type="button" className="qb-link-btn" disabled={!!busy} onClick={() => void takeBack(g)}>Take back</button></>}</li>)}</ul></>}
    </section>
  );
}
