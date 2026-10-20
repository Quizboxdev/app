"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { bootstrapUser } from "@/lib/auth";
import { listTeacherClasses } from "@/lib/api/teacher";
import { listClassLearners, listTeacherTopics, previewTopicPlan, publishTopicAssignment, type TeacherTopic, type TopicPlan } from "@/lib/api/topic-assignments";
import { describeErrorMessage } from "@/lib/errors";
import { splitTopicsForTeacher } from "@/lib/curriculum/display";
import { useDraft } from "@/lib/drafts/use-draft";
import DraftNotice from "@/components/DraftNotice";

type ClassRow = { id: string; class_name: string; grade?: string | null };

// Assign work by topic: tick the topics taught, choose a total, and the questions are spread evenly across them (the remainder goes
// to the topics with the most questions), each topic's share across easy, medium and hard, with every concept of the topic probed.
// A topic that cannot supply its share blocks the assignment and is named; nothing is redistributed silently.
export default function AssignByTopicPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]), [classId, setClassId] = useState("");
  const [topics, setTopics] = useState<TeacherTopic[]>([]), [subject, setSubject] = useState(""), [chosen, setChosen] = useState<string[]>([]);
  const [total, setTotal] = useState(20), [difficulty, setDifficulty] = useState("");
  const [plan, setPlan] = useState<TopicPlan | null>(null), [planError, setPlanError] = useState("");
  const [title, setTitle] = useState(""), [description, setDescription] = useState(""), [mode, setMode] = useState<"PRACTICE" | "ASSESSMENT">("PRACTICE");
  const [attempts, setAttempts] = useState(1), [minutes, setMinutes] = useState(30), [dueAt, setDueAt] = useState("");
  const [learners, setLearners] = useState<Array<{ user_id: string; name: string }>>([]), [everyone, setEveryone] = useState(true), [recipients, setRecipients] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  // Unfinished work is kept as a draft. The class has to load before the topics and learners it holds can be put back, so those wait in `pending`.
  type Held = { classId: string; subject: string; chosen: string[]; total: number; difficulty: string; title: string; description: string; mode: "PRACTICE" | "ASSESSMENT"; attempts: number; minutes: number; dueAt: string; everyone: boolean; recipients: string[] };
  const pending = useRef<Held | null>(null);
  const draft = useDraft<Held>({ kind: "assignment", title, path: "/teacher/assignments/by-topic", empty: !classId && !title.trim(),
    value: { classId, subject, chosen, total, difficulty, title, description, mode, attempts, minutes, dueAt, everyone, recipients },
    apply: (v) => { pending.current = v; setTotal(v.total ?? 20); setDifficulty(v.difficulty ?? ""); setTitle(v.title ?? ""); setDescription(v.description ?? ""); setMode(v.mode ?? "PRACTICE"); setAttempts(v.attempts ?? 1); setMinutes(v.minutes ?? 30); setDueAt(v.dueAt ?? ""); setClassId(v.classId ?? ""); } });

  useEffect(() => {
    bootstrapUser().then((ctx: any) => listTeacherClasses(String(ctx.teacherProfile?.id ?? ""))).then((rows: any[]) => setClasses(rows as ClassRow[]))
      .catch((e: Error) => setError(describeErrorMessage(e.message)));
  }, []);
  useEffect(() => {
    setTopics([]); setSubject(""); setChosen([]); setPlan(null); setLearners([]); setRecipients([]); setEveryone(true);
    if (!classId) return;
    Promise.all([listTeacherTopics(classId), listClassLearners(classId)])
      .then(([t, l]) => {
        setTopics(t); setLearners(l); const first = t[0]?.subject; if (first) setSubject(first);
        const p = pending.current;
        if (p && p.classId === classId) {
          pending.current = null;
          if (p.subject && t.some((x) => x.subject === p.subject)) setSubject(p.subject);
          setChosen((p.chosen ?? []).filter((id) => t.some((x) => x.topic_id === id)));
          setEveryone(p.everyone ?? true); setRecipients((p.recipients ?? []).filter((id) => l.some((x) => x.user_id === id)));
        }
      })
      .catch((e: Error) => setError(describeErrorMessage(e.message)));
  }, [classId]);

  const subjects = useMemo(() => [...new Set(topics.map((t) => t.subject))], [topics]);
  const visible = useMemo(() => topics.filter((t) => !subject || t.subject === subject), [topics, subject]);
  // Only topics with readable names are offered; a topic whose name is still a code is held back (reported to admins), never grouped as "Other".
  const { shown: readable, unlabelled } = useMemo(() => splitTopicsForTeacher(visible), [visible]);

  // The server is the one that decides the split; ask it whenever the choice changes.
  useEffect(() => {
    setPlan(null); setPlanError("");
    if (!classId || chosen.length === 0 || total < chosen.length) return;
    const timer = setTimeout(() => {
      previewTopicPlan(classId, chosen, total, difficulty).then(setPlan).catch((e: Error) => setPlanError(e.message));
    }, 350);
    return () => clearTimeout(timer);
  }, [classId, chosen, total, difficulty]);

  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const ready = Boolean(classId && chosen.length > 0 && plan && !planError && title.trim() && (everyone || recipients.length > 0));

  async function publish() {
    if (!ready || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await publishTopicAssignment({ classId, title: title.trim(), description, topicIds: chosen, total, difficulty: difficulty || undefined, mode, attempts, minutes,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined, targetStudentIds: everyone ? undefined : recipients });
      setNotice(`Assignment published: ${total} questions across ${chosen.length} topic${chosen.length === 1 ? "" : "s"}.`);
      void draft.finish(); setTitle(""); setDescription(""); setChosen([]); setPlan(null);
    } catch (e) { setError(describeErrorMessage((e as Error).message)); } finally { setBusy(false); }
  }

  return <>
    <div className="qb-page-head"><div><h1>Assign by topic</h1>
      <p>Choose the topics you taught and how many questions. They are shared evenly across the topics. <Link href="/teacher/assignments">Assign by single objective instead</Link>.</p></div></div>
    <DraftNotice restored={!!draft.restored} expiresAt={draft.expiresAt} noun="assignment" onDiscard={() => void draft.finish()} />
    {error && <div className="qb-card qb-error" role="alert">{error}</div>}{notice && <div className="qb-card" role="status">{notice}</div>}

    <section className="qb-card"><h2>1. Class and subject</h2>
      <div className="qb-grid cols-2">
        <div className="qb-field"><label htmlFor="bt-class">Class</label>
          <select id="bt-class" value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">Select class</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.class_name}</option>)}</select></div>
        <div className="qb-field"><label htmlFor="bt-subject">Subject</label>
          <select id="bt-subject" value={subject} onChange={(e) => { setSubject(e.target.value); setChosen([]); }} disabled={subjects.length === 0}>
            {subjects.length === 0 ? <option value="">No topics are open yet</option> : subjects.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
      </div>
      {classId && topics.length === 0 && <p className="qb-muted">No topics are open for this class yet. Topics open when enough approved questions exist.</p>}
    </section>

    {visible.length > 0 && <section className="qb-card"><h2>2. Topics</h2>
      <p className="qb-muted">Tick every topic to include. The number beside a topic is how many approved questions it has now.</p>
      <div className="qb-list">
        {readable.map((t) => <label key={t.topic_id} className="qb-row">
          <input type="checkbox" checked={chosen.includes(t.topic_id)} disabled={t.available === 0} onChange={() => toggle(t.topic_id)}/>
          <span><strong>{t.label}</strong> <span className="qb-muted">· {t.available} question{t.available === 1 ? "" : "s"}{t.hint ? ` · ${t.hint}` : ""}{t.concepts.length ? ` · ${t.concepts.join(", ")}` : ""}</span></span>
        </label>)}
      </div>
      {unlabelled.length > 0 && <p className="qb-muted qb-small">{unlabelled.length} more topic{unlabelled.length === 1 ? " is" : "s are"} not shown yet while we finish preparing {unlabelled.length === 1 ? "it" : "them"}.</p>}
    </section>}

    {chosen.length > 0 && <section className="qb-card"><h2>3. How many questions</h2>
      <div className="qb-grid cols-2">
        <div className="qb-field"><label htmlFor="bt-total">Total questions</label>
          <input id="bt-total" type="number" min={chosen.length} max={100} value={total} onChange={(e) => setTotal(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}/></div>
        <div className="qb-field"><label htmlFor="bt-diff">Difficulty</label>
          <select id="bt-diff" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}><option value="">Mixed (easy, medium and hard)</option><option value="easy">Easy only</option><option value="medium">Medium only</option><option value="hard">Hard only</option></select></div>
      </div>
      {total < chosen.length && <p className="qb-error" role="alert">Choose at least {chosen.length} questions, one for each topic.</p>}
      {planError && <p className="qb-error" role="alert">{planError}</p>}
      {plan && <div className="qb-table-wrap"><table className="qb-table"><caption className="qb-sr-only">How the questions are shared</caption>
        <thead><tr><th>Topic</th><th>Questions</th><th>Easy</th><th>Medium</th><th>Hard</th></tr></thead>
        <tbody>{plan.shares.map((s) => ({ ...s, name: readable.find((t) => t.topic_id === s.topic_id)?.label ?? s.title })).sort((a, b) => a.name.localeCompare(b.name)).map((s) => <tr key={s.topic_id}><td>{s.name}</td><td>{s.share}</td><td>{s.easy}</td><td>{s.medium}</td><td>{s.hard}</td></tr>)}</tbody></table></div>}
      {plan && <p className="qb-muted">Questions are picked when you publish, so two assignments on the same topics differ. Nothing repeats within an assignment.</p>}
    </section>}

    {plan && <section className="qb-card"><h2>4. Details and recipients</h2>
      <div className="qb-form">
        <div className="qb-field"><label htmlFor="bt-title">Title</label><input id="bt-title" value={title} onChange={(e) => setTitle(e.target.value)}/></div>
        <div className="qb-field"><label htmlFor="bt-desc">Instructions</label><textarea id="bt-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)}/></div>
        <div className="qb-grid cols-2">
          <div className="qb-field"><label htmlFor="bt-mode">Mode</label><select id="bt-mode" value={mode} onChange={(e) => setMode(e.target.value as "PRACTICE" | "ASSESSMENT")}><option value="PRACTICE">Practice</option><option value="ASSESSMENT">Assessment</option></select></div>
          <div className="qb-field"><label htmlFor="bt-att">Attempts</label><input id="bt-att" type="number" min={1} max={10} value={attempts} onChange={(e) => setAttempts(Math.max(1, Number(e.target.value) || 1))}/></div>
          <div className="qb-field"><label htmlFor="bt-min">Time limit (minutes)</label><input id="bt-min" type="number" min={1} max={180} value={minutes} onChange={(e) => setMinutes(Math.max(1, Number(e.target.value) || 1))}/></div>
          <div className="qb-field"><label htmlFor="bt-due">Due date</label><input id="bt-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)}/></div>
        </div>
        <fieldset><legend>Who receives it</legend>
          <label><input type="radio" name="bt-who" checked={everyone} onChange={() => setEveryone(true)}/> Every learner in the class</label>{" "}
          <label><input type="radio" name="bt-who" checked={!everyone} onChange={() => setEveryone(false)}/> Selected learners only (for example those who missed the lesson)</label>
          {!everyone && <div className="qb-list">{learners.length === 0 ? <p className="qb-muted">No learners are enrolled in this class yet.</p>
            : learners.map((l) => <label key={l.user_id} className="qb-row"><input type="checkbox" checked={recipients.includes(l.user_id)}
                onChange={() => setRecipients((r) => (r.includes(l.user_id) ? r.filter((x) => x !== l.user_id) : [...r, l.user_id]))}/>{l.name}</label>)}</div>}
        </fieldset>
        <button className="qb-btn" disabled={!ready || busy} onClick={() => void publish()}>{busy ? "Publishing…" : "Publish assignment"}</button>
      </div>
    </section>}
  </>;
}
