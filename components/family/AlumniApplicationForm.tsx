"use client";

import { FormEvent, useEffect, useState } from "react";
import { applyForFamily, myFamilyApplication, type MyApplication } from "@/lib/api/family";

// Shown instead of the Family workspace to an alumni sponsor who has not been approved yet. Alumni sponsors join a school's competitions by invitation;
// to support selected students through a family they apply here. QuizBox staff or the school's administrator decide.
export default function AlumniApplicationForm() {
  const [mine, setMine] = useState<MyApplication | null>(null), [school, setSchool] = useState(""), [note, setNote] = useState(""), [students, setStudents] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const load = () => myFamilyApplication().then(setMine).catch(() => setMine(null));
  useEffect(() => { void load(); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { await applyForFamily(school, note, students); await load(); } catch (cause) { setError((cause as Error).message); }
    setBusy(false);
  }
  const status = mine?.application?.status;
  if (status === "submitted") return <section className="qb-card" role="status"><h1 style={{ marginTop: 0 }}>Your application is with the approvers</h1><p className="qb-muted">We have your application for {mine?.application?.school_name}. QuizBox staff or the school&apos;s administrator will decide, and you will get a notification.</p></section>;
  return (
    <section className="qb-card" aria-labelledby="alumni-apply-title" style={{ display: "grid", gap: 12, maxWidth: 640 }}>
      <h1 id="alumni-apply-title" style={{ margin: 0 }}>Apply to create a family</h1>
      <p className="qb-muted" style={{ margin: 0 }}>Alumni sponsors take part in a school&apos;s competitions by invitation. To support selected students through a family, tell us about the school and who you want to support. Each student, or their guardian, still has to agree.</p>
      {status === "declined" && <p className="qb-error" role="status" style={{ margin: 0 }}>Your last application was declined{mine?.application?.decision_note ? `: ${mine.application.decision_note}` : "."} You can apply again.</p>}
      <form className="qb-form" onSubmit={submit}>
        <div className="qb-field"><label htmlFor="fa-school">School</label><input id="fa-school" value={school} onChange={(e) => setSchool(e.target.value)} required minLength={2} maxLength={200} /></div>
        <div className="qb-field"><label htmlFor="fa-note">Your connection to the school</label><textarea id="fa-note" value={note} onChange={(e) => setNote(e.target.value)} required minLength={10} maxLength={1500} placeholder="For example: the years you attended and your role in the old students association." /></div>
        <div className="qb-field"><label htmlFor="fa-students">Who you want to support, and how they are chosen</label><textarea id="fa-students" value={students} onChange={(e) => setStudents(e.target.value)} required minLength={10} maxLength={1500} /></div>
        {error && <p className="qb-error" role="alert" style={{ margin: 0 }}>{error}</p>}
        <button className="qb-btn" type="submit" disabled={busy}>{busy ? "Sending…" : "Send application"}</button>
      </form>
    </section>
  );
}
