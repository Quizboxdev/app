"use client";

import { FormEvent, useState } from "react";
import { addChild, type ChildLink } from "@/lib/api/family";
import { useGrades } from "@/components/family/useGrades";

// "Add child": the parent creates a student account for their child. No public sign-up: the child gets a single-use link to choose a password.
export default function AddChildForm({ onAdded, onCancel }: { onAdded: (link: ChildLink, name: string) => void; onCancel: () => void }) {
  const { grades, levels, ready } = useGrades();
  const [first, setFirst] = useState(""), [last, setLast] = useState(""), [display, setDisplay] = useState(""), [age, setAge] = useState(""), [level, setLevel] = useState(""), [grade, setGrade] = useState(""), [school, setSchool] = useState("");
  const [agree, setAgree] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const shown = grades.filter((g) => !level || g.level === level);

  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { const r = await addChild({ firstName: first, lastName: last, displayName: display, age: Number(age), gradeCode: grade, school }); onAdded(r, display.trim() || first.trim()); }
    catch (cause) { setError((cause as Error).message); }
    setBusy(false);
  }
  return (
    <form className="qb-card qb-form" onSubmit={submit} aria-labelledby="add-child-title" style={{ display: "grid", gap: 12 }}>
      <h2 id="add-child-title" style={{ margin: 0 }}>Add a child</h2>
      <p className="qb-muted" style={{ margin: 0 }}>We make a QuizBox student account for your child. They do not need to sign up: you send them a link and they choose their own password.</p>
      <div className="qb-grid cols-2">
        <div className="qb-field"><label htmlFor="ac-first">First name</label><input id="ac-first" value={first} onChange={(e) => setFirst(e.target.value)} required maxLength={40} autoComplete="off" /></div>
        <div className="qb-field"><label htmlFor="ac-last">Last name</label><input id="ac-last" value={last} onChange={(e) => setLast(e.target.value)} maxLength={40} autoComplete="off" /></div>
        <div className="qb-field"><label htmlFor="ac-display">Display name (optional)</label><input id="ac-display" value={display} onChange={(e) => setDisplay(e.target.value)} maxLength={40} placeholder="What other people see" /></div>
        <div className="qb-field"><label htmlFor="ac-age">Age</label><input id="ac-age" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 2))} required /></div>
        <div className="qb-field"><label htmlFor="ac-level">Education level</label>
          <select id="ac-level" value={level} onChange={(e) => { setLevel(e.target.value); setGrade(""); }}><option value="">All levels</option>{levels.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select></div>
        <div className="qb-field"><label htmlFor="ac-grade">Class</label>
          <select id="ac-grade" value={grade} onChange={(e) => setGrade(e.target.value)} required><option value="">{ready ? "Choose their class" : "Loading classes…"}</option>{shown.map((g) => <option key={g.code} value={g.code}>{g.label}</option>)}</select></div>
      </div>
      <div className="qb-field"><label htmlFor="ac-school">School (optional)</label><input id="ac-school" value={school} onChange={(e) => setSchool(e.target.value)} maxLength={200} autoComplete="off" /></div>
      <label className="qb-check" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 4 }} />
        <span>I am this child&apos;s parent or guardian and I agree to set up their QuizBox account. Children under 13 get extra protection.</span></label>
      {error && <div role="alert" className="qb-error">{error}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="qb-btn" type="submit" disabled={busy || !agree || !first.trim() || !age || !grade}>{busy ? "Adding…" : "Add child"}</button>
        <button className="qb-btn secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
