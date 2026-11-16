"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { familyClassFor, listFamilyAssignments, listFamilyChildren, type FamilyAssignment, type FamilyChild, type FamilyClass } from "@/lib/api/family";
import { listTeacherTopics, previewTopicPlan, publishTopicAssignment, type TeacherTopic, type TopicPlan } from "@/lib/api/topic-assignments";
import { describeErrorMessage } from "@/lib/errors";
import { niceTitle } from "@/lib/curriculum/display";
import ChildPicker from "@/components/family/ChildPicker";

// Give work: pick a class level, tick the children, choose the subject and topics, and send. It uses the same topic tests teachers send, so the questions, marking and results are
// the same; the work reaches each child in their own workspace marked as Family. Children in different classes are sent separate pieces of work because their topics differ.
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");
const STATUS = { done: "Done", started: "Started", not_started: "Not started" } as const;

function GiveWork() {
  const preset = useSearchParams().get("child");
  const [kids, setKids] = useState<FamilyChild[] | null>(null), [grade, setGrade] = useState(""), [klass, setKlass] = useState<FamilyClass | null>(null);
  const [ids, setIds] = useState<string[]>([]), [topics, setTopics] = useState<TeacherTopic[]>([]), [subject, setSubject] = useState(""), [picked, setPicked] = useState<string[]>([]);
  const [total, setTotal] = useState(10), [mode, setMode] = useState<"PRACTICE" | "ASSESSMENT">("PRACTICE"), [attempts, setAttempts] = useState(1), [minutes, setMinutes] = useState(20), [dueAt, setDueAt] = useState(""), [title, setTitle] = useState("");
  const [plan, setPlan] = useState<TopicPlan | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");
  const [work, setWork] = useState<FamilyAssignment[]>([]);

  const loadWork = useCallback(() => { listFamilyAssignments().then(setWork).catch(() => undefined); }, []);
  useEffect(() => {
    listFamilyChildren().then((rows) => {
      const active = rows.filter((c) => c.status === "active" && c.permissions?.assign);
      setKids(active);
      const first = active.find((c) => c.student_id === preset) ?? active[0];
      if (first?.grade_code) { setGrade(first.grade_code); if (first.student_id && first.student_id === preset) setIds([first.student_id]); }
    }).catch((e: Error) => { setKids([]); setError(e.message); });
    loadWork();
  }, [preset, loadWork]);

  const grades = useMemo(() => [...new Set((kids ?? []).map((c) => c.grade_code).filter((g): g is string => !!g))].sort(), [kids]);
  const inGrade = useMemo(() => (kids ?? []).filter((c) => c.grade_code === grade), [kids, grade]);

  useEffect(() => {
    setKlass(null); setTopics([]); setSubject(""); setPicked([]); setPlan(null);
    if (!grade) return;
    let live = true;
    familyClassFor(grade).then(async (c) => { if (!live) return; setKlass(c); setTopics(await listTeacherTopics(c.class_id)); }).catch((e: Error) => { if (live) setError(describeErrorMessage(e.message)); });
    return () => { live = false; };
  }, [grade]);
  useEffect(() => { setIds((cur) => cur.filter((id) => inGrade.some((c) => c.student_id === id))); }, [inGrade]);

  const subjects = useMemo(() => [...new Set(topics.map((t) => t.subject))].sort(), [topics]);
  const shown = useMemo(() => topics.filter((t) => t.subject === subject && t.available > 0), [topics, subject]);
  const room = picked.reduce((n, id) => n + (topics.find((t) => t.topic_id === id)?.available ?? 0), 0);
  useEffect(() => { setPlan(null); }, [picked, total]);

  async function preview() {
    if (!klass) return; setBusy(true); setError(""); setNote("");
    try { setPlan(await previewTopicPlan(klass.class_id, picked, total)); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  async function send() {
    if (!klass || !plan) return; setBusy(true); setError(""); setNote("");
    try {
      const name = title.trim() || `${niceTitle(subject)} practice`;
      await publishTopicAssignment({ classId: klass.class_id, title: name, description: "", topicIds: picked, total, mode, attempts, minutes, dueAt: dueAt ? new Date(dueAt).toISOString() : undefined, targetStudentIds: ids });
      setNote(`Sent to ${ids.length} child${ids.length === 1 ? "" : "ren"}. They will find it in their workspace marked as Family.`); setPicked([]); setPlan(null); setTitle(""); loadWork();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  if (kids === null) return <div className="qb-card qb-skeleton" style={{ minHeight: 160 }} aria-busy="true" aria-label="Loading" />;
  if (!kids.length) return <section className="qb-card"><h1 style={{ marginTop: 0 }}>Give work</h1><p className="qb-muted">Add a child first, then you can give them work.</p><Link className="qb-btn" href="/family">Go to my family</Link></section>;
  const ready = ids.length > 0 && picked.length > 0 && total >= 1 && total <= room;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <p style={{ margin: 0 }}><Link className="qb-link" href="/family">&larr; My family</Link></p>
      <header><h1 style={{ margin: 0 }}>Give work</h1><p className="qb-muted" style={{ margin: "4px 0 0" }}>Choose who it is for, then the subject and topics. The questions are the same approved ones teachers use.</p></header>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {note && <div className="qb-card" role="status"><strong>{note}</strong></div>}

      <section className="qb-card" style={{ display: "grid", gap: 12 }} aria-labelledby="gw-who">
        <h2 id="gw-who" style={{ margin: 0 }}>1. Who is it for?</h2>
        {grades.length > 1 && <div className="qb-chip-row" role="group" aria-label="Class level">{grades.map((g) => <button key={g} type="button" className="qb-chip" aria-pressed={grade === g} onClick={() => setGrade(g)}>{g}</button>)}</div>}
        <ChildPicker legend={`Children in ${grade || "this class"}`} value={ids} onChange={setIds} options={inGrade.map((c) => ({ id: c.student_id as string, name: c.full_name ?? "Child", detail: c.school_name ?? undefined }))} />
      </section>

      <section className="qb-card" style={{ display: "grid", gap: 12 }} aria-labelledby="gw-what">
        <h2 id="gw-what" style={{ margin: 0 }}>2. What should they practise?</h2>
        {!klass ? <p className="qb-muted" role="status">Getting the topics for {grade || "this class"}…</p> : !subjects.length ? <p className="qb-muted">No topics are open for {grade} yet. We open topics as soon as they have enough approved questions.</p> : <>
          <div className="qb-field"><label htmlFor="gw-subject">Subject</label>
            <select id="gw-subject" value={subject} onChange={(e) => { setSubject(e.target.value); setPicked([]); }}><option value="">Choose a subject</option>{subjects.map((s) => <option key={s} value={s}>{niceTitle(s)}</option>)}</select></div>
          {subject && <fieldset style={{ border: "1px solid var(--line-control, #cbd5e1)", borderRadius: 12, padding: 12, margin: 0, display: "grid", gap: 6, maxHeight: 320, overflow: "auto" }}>
            <legend style={{ padding: "0 6px", fontWeight: 600 }}>Topics</legend>
            {shown.map((t) => <label key={t.topic_id} className="qb-check" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input type="checkbox" checked={picked.includes(t.topic_id)} style={{ marginTop: 4 }} onChange={() => setPicked((p) => (p.includes(t.topic_id) ? p.filter((x) => x !== t.topic_id) : [...p, t.topic_id]))} />
              <span>{niceTitle(t.title)}<span className="qb-muted qb-small" style={{ display: "block" }}>{t.available} questions</span></span></label>)}
          </fieldset>}
        </>}
      </section>

      <section className="qb-card qb-form" style={{ display: "grid", gap: 12 }} aria-labelledby="gw-how">
        <h2 id="gw-how" style={{ margin: 0 }}>3. How should it work?</h2>
        <div className="qb-grid cols-2">
          <div className="qb-field"><label htmlFor="gw-title">Name (optional)</label><input id="gw-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fractions revision" /></div>
          <div className="qb-field"><label htmlFor="gw-total">Number of questions</label><input id="gw-total" inputMode="numeric" value={total} onChange={(e) => setTotal(Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 0))} />
            {picked.length > 0 && <span className="qb-muted qb-small">{room} available in the topics you chose</span>}</div>
          <div className="qb-field"><label htmlFor="gw-mode">Type</label><select id="gw-mode" value={mode} onChange={(e) => setMode(e.target.value as "PRACTICE" | "ASSESSMENT")}><option value="PRACTICE">Practice (they see answers as they go)</option><option value="ASSESSMENT">Test (answers after they finish)</option></select></div>
          <div className="qb-field"><label htmlFor="gw-due">Due date (optional)</label><input id="gw-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></div>
          <div className="qb-field"><label htmlFor="gw-attempts">Tries allowed</label><input id="gw-attempts" inputMode="numeric" value={attempts} onChange={(e) => setAttempts(Math.max(1, Math.min(10, Number(e.target.value.replace(/\D/g, "")) || 1)))} /></div>
          <div className="qb-field"><label htmlFor="gw-min">Minutes allowed</label><input id="gw-min" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(Math.max(1, Math.min(180, Number(e.target.value.replace(/\D/g, "")) || 1)))} /></div>
        </div>
        {plan && <div role="status" className="qb-muted">Plan: {plan.shares.map((s) => `${niceTitle(s.title)} ${s.share}`).join(", ")}.</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="qb-btn secondary" type="button" disabled={busy || !ready} onClick={() => void preview()}>{busy && !plan ? "Checking…" : "Check the questions"}</button>
          <button className="qb-btn" type="button" disabled={busy || !ready || !plan} onClick={() => void send()}>{busy && plan ? "Sending…" : `Send to ${ids.length || "…"} ${ids.length === 1 ? "child" : "children"}`}</button>
        </div>
        {!ready && <p className="qb-muted qb-small" style={{ margin: 0 }}>{!ids.length ? "Tick at least one child." : !picked.length ? "Choose at least one topic." : total > room ? "There are not enough questions in those topics. Choose more topics or fewer questions." : "Enter the number of questions."}</p>}
      </section>

      <section aria-labelledby="gw-sent"><h2 id="gw-sent" style={{ margin: "0 0 8px" }}>Work you have given</h2>
        {!work.length ? <div className="qb-card qb-empty"><strong>Nothing yet</strong>Work you send appears here with each child&apos;s progress.</div> : (
          <div style={{ display: "grid", gap: 8 }}>{work.map((a) => (
            <div key={a.assignment_id} className="qb-card" style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><strong>{a.title}</strong><span className="qb-muted qb-small">{a.question_count} questions{a.due_at ? ` · due ${when(a.due_at)}` : ""}</span></div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{a.children.map((k) => <span key={k.student_id} className="qb-chip" style={{ minHeight: 28, padding: "0 10px", fontSize: 12.5 }}>{k.name}: {STATUS[k.status]}{k.percentage !== null ? ` · ${Math.round(Number(k.percentage))}%` : ""}</span>)}</div>
            </div>))}</div>)}
      </section>
    </div>
  );
}

export default function FamilyAssignPage() { return <Suspense fallback={<div className="qb-card qb-skeleton" style={{ minHeight: 160 }} aria-busy="true" />}><GiveWork /></Suspense>; }
