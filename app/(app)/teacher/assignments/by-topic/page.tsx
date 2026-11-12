"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { bootstrapUser } from "@/lib/auth";
import { listTeacherClasses } from "@/lib/api/teacher";
import { listClassLearners, listTeacherTopics, type TeacherTopic } from "@/lib/api/topic-assignments";
import { previewBlueprint, publishBlueprint, type BlueprintPlan } from "@/lib/api/blueprint";
import { createSchedule, isoWeekday, WEEKDAYS } from "@/lib/api/schedules";
import { canCombineSubjects, classLevel, sectionProblems, sectionsFromLegacyDraft, splitEvenly, toApiSections, totalOf, type SectionDraft } from "@/lib/learning/blueprint";
import { describeErrorMessage } from "@/lib/errors";
import { splitTopicsForTeacher } from "@/lib/curriculum/display";
import { useDraft } from "@/lib/drafts/use-draft";
import DraftNotice from "@/components/DraftNotice";
import KnowledgeWindow, { KnowledgeWindowGrid } from "@/components/qinsignia/KnowledgeWindow";
import { useWorkspaceFlags } from "@/components/WorkspaceProvider";
import { teacherSubjectView } from "@/lib/learning/subject-card-state";

type ClassRow = { id: string; class_name: string; grade?: string | null; grade_code?: string | null; education_level?: string | null };
type Difficulty = "" | "easy" | "medium" | "hard";
const DEFAULT_QUOTA = 10;
// The grade a topic list is held to: the class's own, with the legacy B10 read as SHS1 (as the database does).
const classGrade = (c?: ClassRow) => { const g = String(c?.grade_code || c?.grade || "").trim().toUpperCase(); return g === "B10" ? "SHS1" : g; };

// Assign a test by subject and topic. In a Primary or JHS class one test can combine several subjects (a teacher there often teaches more than one);
// each subject is a section with its own number of questions, and either named topics or "any topic" of that subject. Within a section the questions
// are spread evenly across its topics, each topic's share across easy, medium and hard, with every concept probed. A topic that cannot supply its share
// blocks the test and is named; nothing is redistributed silently (except on "any topic", where the teacher left the choice to the system).
export default function AssignByTopicPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]), [classId, setClassId] = useState("");
  const [topics, setTopics] = useState<TeacherTopic[]>([]), [sections, setSections] = useState<SectionDraft[]>([]), [difficulty, setDifficulty] = useState<Difficulty>("");
  const [plan, setPlan] = useState<BlueprintPlan | null>(null), [planError, setPlanError] = useState("");
  const [title, setTitle] = useState(""), [description, setDescription] = useState(""), [mode, setMode] = useState<"PRACTICE" | "ASSESSMENT">("PRACTICE");
  const [attempts, setAttempts] = useState(1), [minutes, setMinutes] = useState(30), [dueAt, setDueAt] = useState("");
  const [learners, setLearners] = useState<Array<{ user_id: string; name: string }>>([]), [everyone, setEveryone] = useState(true), [recipients, setRecipients] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  // Repeat every week (flag repeat_assignments): this one goes out now; the same shape goes out again on this weekday and time, with fresh questions.
  const [repeat, setRepeat] = useState(false), [weekday, setWeekday] = useState(() => isoWeekday(new Date())), [repeatTime, setRepeatTime] = useState("16:00"), [dueAfterDays, setDueAfterDays] = useState(3);
  const repeatOn = useWorkspaceFlags().repeat_assignments;
  // Unfinished work is kept as a draft. The class has to load before the topics and learners it holds can be put back, so those wait in `pending`.
  // A draft saved before sections existed (one subject, ticked topics, one total) comes back as a single section.
  type Held = { classId: string; sections?: SectionDraft[]; subject?: string; chosen?: string[]; total?: number; difficulty: string; title: string; description: string; mode: "PRACTICE" | "ASSESSMENT"; attempts: number; minutes: number; dueAt: string; everyone: boolean; recipients: string[] };
  const pending = useRef<Held | null>(null);
  const draft = useDraft<Held>({ kind: "assignment", title, path: "/teacher/assignments/by-topic", empty: !classId && !title.trim(),
    value: { classId, sections, difficulty, title, description, mode, attempts, minutes, dueAt, everyone, recipients },
    apply: (v) => { pending.current = v; setDifficulty((v.difficulty ?? "") as Difficulty); setTitle(v.title ?? ""); setDescription(v.description ?? ""); setMode(v.mode ?? "PRACTICE"); setAttempts(v.attempts ?? 1); setMinutes(v.minutes ?? 30); setDueAt(v.dueAt ?? ""); setClassId(v.classId ?? ""); } });

  useEffect(() => {
    bootstrapUser().then((ctx: any) => listTeacherClasses(String(ctx.teacherProfile?.id ?? ""))).then((rows: any[]) => setClasses(rows as ClassRow[]))
      .catch((e: Error) => setError(describeErrorMessage(e.message)));
  }, []);
  useEffect(() => {
    setTopics([]); setSections([]); setPlan(null); setLearners([]); setRecipients([]); setEveryone(true);
    if (!classId) return;
    Promise.all([listTeacherTopics(classId), listClassLearners(classId)])
      .then(([t, l]) => {
        setTopics(t); setLearners(l);
        const p = pending.current;
        if (p && p.classId === classId) {
          pending.current = null;
          const held = p.sections ?? sectionsFromLegacyDraft(p);
          setSections(held.filter((s) => t.some((x) => x.subject === s.subject)).map((s) => ({ ...s, topicIds: s.topicIds.filter((id) => t.some((x) => x.topic_id === id)) })));
          setEveryone(p.everyone ?? true); setRecipients((p.recipients ?? []).filter((id) => l.some((x) => x.user_id === id)));
        }
      })
      .catch((e: Error) => setError(describeErrorMessage(e.message)));
  }, [classId]);

  const cls = classes.find((c) => c.id === classId);
  const level = classLevel(cls?.grade_code || cls?.grade, cls?.education_level);
  const combine = canCombineSubjects(level);
  // The test is held to the class's own grade when the class has topics for it (a topic of another grade is refused by the database anyway).
  const grade = classGrade(cls);
  const classTopics = useMemo(() => { const own = topics.filter((t) => t.grade === grade); return own.length > 0 ? own : topics; }, [topics, grade]);
  const bySubject = useMemo(() => {
    const m = new Map<string, ReturnType<typeof splitTopicsForTeacher<TeacherTopic>>>();
    for (const name of new Set(classTopics.map((t) => t.subject))) m.set(name, splitTopicsForTeacher(classTopics.filter((t) => t.subject === name)));
    return m;
  }, [classTopics]);
  const subjectStats = useMemo(() => [...bySubject.entries()].map(([name, { shown }]) => ({ name, topics: shown.length, available: shown.reduce((n, t) => n + t.available, 0) })), [bySubject]);
  // Q-Insignia pilot (flag q_insignia_subject_cards_v02): the subject choice becomes photo cards. Same data, same handler, same draft.
  const cards = useWorkspaceFlags().q_insignia_subject_cards_v02;

  const has = (name: string) => sections.some((s) => s.subject === name);
  // Combined classes toggle subjects on and off; a Senior High class keeps one subject and choosing another replaces it.
  const pickSubject = (name: string) => {
    if (combine) setSections((cur) => (cur.some((s) => s.subject === name) ? cur.filter((s) => s.subject !== name) : [...cur, { subject: name, mode: "any", topicIds: [], quota: DEFAULT_QUOTA }]));
    else if (!has(name) || sections.length !== 1) setSections([{ subject: name, mode: "any", topicIds: [], quota: totalOf(sections) || DEFAULT_QUOTA }]);
  };
  const patch = (name: string, change: Partial<SectionDraft>) => setSections((cur) => cur.map((s) => (s.subject === name ? { ...s, ...change } : s)));
  const toggleTopic = (name: string, id: string) => setSections((cur) => cur.map((s) => (s.subject !== name ? s
    : { ...s, topicIds: s.topicIds.includes(id) ? s.topicIds.filter((x) => x !== id) : [...s.topicIds, id] })));
  const total = totalOf(sections);
  const shareTotal = (n: number) => { const q = splitEvenly(Math.max(sections.length, Math.min(100, n)), sections.length); setSections((cur) => cur.map((s, i) => ({ ...s, quota: q[i] }))); };

  const problems = useMemo(() => (classId ? sectionProblems(sections, level) : []), [classId, sections, level]);
  const sectionKey = JSON.stringify(toApiSections(sections));
  // The server is the one that decides the split; ask it whenever the choice changes.
  useEffect(() => {
    setPlan(null); setPlanError("");
    if (!classId || sections.length === 0 || problems.length > 0) return;
    const timer = setTimeout(() => {
      previewBlueprint(classId, toApiSections(sections), difficulty).then(setPlan).catch((e: Error) => setPlanError(e.message));
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, sectionKey, difficulty, problems.length]);

  const ready = Boolean(classId && sections.length > 0 && problems.length === 0 && plan && !planError && title.trim() && (everyone || recipients.length > 0));

  async function publish() {
    if (!ready || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await publishBlueprint({ classId, title: title.trim(), description, sections: toApiSections(sections), difficulty: difficulty || undefined, mode, attempts, minutes,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined, targetStudentIds: everyone ? undefined : recipients });
      const made = `Assignment published: ${total} questions across ${sections.length} subject${sections.length === 1 ? "" : "s"}.`;
      let again = "";
      if (repeatOn && repeat && everyone) {
        // The assignment is already out; a problem setting up the repeat is reported without undoing it.
        try {
          await createSchedule({ classId, title: title.trim(), description, sections: toApiSections(sections), difficulty: difficulty || undefined, mode, attempts, minutes,
            weekday, time: repeatTime, dueAfterDays });
          again = ` It will repeat every ${WEEKDAYS[weekday - 1]} at ${repeatTime}.`;
        } catch (e) { again = ` It was not set to repeat: ${describeErrorMessage((e as Error).message)}`; }
      }
      setNotice(made + again);
      void draft.finish(); setTitle(""); setDescription(""); setSections([]); setPlan(null); setRepeat(false);
    } catch (e) { setError(describeErrorMessage((e as Error).message)); } finally { setBusy(false); }
  }

  const label = (subject: string, id: string) => bySubject.get(subject)?.shown.find((t) => t.topic_id === id)?.label;

  return <>
    <div className="qb-page-head"><div><h1>Assign by subject and topic</h1>
      <p>Choose what you taught and how many questions. {combine ? "A test can combine several subjects, each with its own number of questions." : "Choose a subject and its topics."} <Link href="/teacher/assignments">Assign by single objective instead</Link>.{repeatOn && <> <Link href="/teacher/assignments/repeating">Repeating assignments</Link>.</>}</p></div></div>
    <DraftNotice restored={!!draft.restored} expiresAt={draft.expiresAt} noun="assignment" onDiscard={() => void draft.finish()} />
    {error && <div className="qb-card qb-error" role="alert">{error}</div>}{notice && <div className="qb-card" role="status">{notice}</div>}
    <section className="qb-card"><h2>1. Class and subjects</h2>
      <div className="qb-grid cols-2">
        <div className="qb-field"><label htmlFor="bt-class">Class</label>
          <select id="bt-class" value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">Select class</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.class_name}</option>)}</select></div>
        {!cards && subjectStats.length > 0 && <fieldset className="qb-field"><legend>{combine ? "Subjects in this test" : "Subject"}</legend>
          {combine
            ? subjectStats.map((s) => <label key={s.name} className="qb-row"><input type="checkbox" checked={has(s.name)} onChange={() => pickSubject(s.name)}/><span>{s.name} <span className="qb-muted">· {s.available} question{s.available === 1 ? "" : "s"}</span></span></label>)
            : <select aria-label="Subject" value={sections[0]?.subject ?? ""} onChange={(e) => pickSubject(e.target.value)}><option value="">Choose a subject</option>{subjectStats.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</select>}
        </fieldset>}
      </div>
      {cards && <div className="qb-field" style={{ marginTop: 12 }}>
        <p id="bt-subject-label" className="qb-overline" style={{ margin: "0 0 8px" }}>{combine ? "Subjects in this test (choose one or more)" : "Subject"}</p>
        {subjectStats.length === 0 ? <p className="qb-muted">{classId ? "No topics are open yet" : "Choose a class first"}</p>
          : <KnowledgeWindowGrid dense label="Subjects for this assignment">
            {subjectStats.map((s) => <KnowledgeWindow key={s.name} variant="selector" name={s.name} selected={has(s.name)} onSelect={() => pickSubject(s.name)}
              meta={`${s.topics} topic${s.topics === 1 ? "" : "s"} · ${s.available} question${s.available === 1 ? "" : "s"}`} view={teacherSubjectView({ available: s.available, actionLabel: "Choose" })} />)}
          </KnowledgeWindowGrid>}
      </div>}
      {classId && !combine && <p className="qb-muted qb-small">{level === "SHS" ? "A Senior High test uses one subject." : "This class's level is not set, so a test uses one subject."}</p>}
      {classId && topics.length === 0 && <p className="qb-muted">No topics are open for this class yet. Topics open when enough approved questions exist.</p>}
    </section>

    {sections.length > 0 && <section className="qb-card"><h2>2. Topics and questions for each subject</h2>
      <p className="qb-muted">For each subject choose how many questions, and either name the topics or let the system choose from the subject&apos;s topics.</p>
      {sections.map((s) => { const { shown, unlabelled } = bySubject.get(s.subject) ?? { shown: [], unlabelled: [] };
        const avail = s.mode === "pick" ? shown.filter((t) => s.topicIds.includes(t.topic_id)).reduce((n, t) => n + t.available, 0) : shown.reduce((n, t) => n + t.available, 0);
        return <fieldset key={s.subject} className="qb-card" style={{ marginTop: 12 }}>
          <legend><strong>{s.subject}</strong></legend>
          <div className="qb-grid cols-2">
            <div className="qb-field"><label htmlFor={`bt-q-${s.subject}`}>Questions from {s.subject}</label>
              <input id={`bt-q-${s.subject}`} type="number" min={1} max={100} value={s.quota} onChange={(e) => patch(s.subject, { quota: Math.max(0, Math.min(100, Math.floor(Number(e.target.value) || 0))) })}/></div>
            <div className="qb-field"><label htmlFor={`bt-d-${s.subject}`}>Difficulty for {s.subject}</label>
              <select id={`bt-d-${s.subject}`} value={s.difficulty ?? ""} onChange={(e) => patch(s.subject, { difficulty: e.target.value as Difficulty })}>
                <option value="">Same as the whole test</option><option value="easy">Easy only</option><option value="medium">Medium only</option><option value="hard">Hard only</option></select></div>
          </div>
          <div role="radiogroup" aria-label={`Topics for ${s.subject}`}>
            <label><input type="radio" name={`bt-m-${s.subject}`} checked={s.mode === "any"} onChange={() => patch(s.subject, { mode: "any", topicIds: [] })}/> Any topic of {s.subject} (the system chooses)</label>{" "}
            <label><input type="radio" name={`bt-m-${s.subject}`} checked={s.mode === "pick"} onChange={() => patch(s.subject, { mode: "pick" })}/> Choose the topics myself</label>
          </div>
          {s.mode === "pick" && <div className="qb-list">
            {shown.map((t) => <label key={t.topic_id} className="qb-row">
              <input type="checkbox" checked={s.topicIds.includes(t.topic_id)} disabled={t.available === 0} onChange={() => toggleTopic(s.subject, t.topic_id)}/>
              <span><strong>{t.label}</strong> <span className="qb-muted">· {t.available} question{t.available === 1 ? "" : "s"}{t.concepts.length ? ` · ${t.concepts.join(", ")}` : ""}</span></span>
            </label>)}
          </div>}
          {unlabelled.length > 0 && s.mode === "pick" && <p className="qb-muted qb-small">{unlabelled.length} more topic{unlabelled.length === 1 ? " is" : "s are"} not shown yet while we finish preparing {unlabelled.length === 1 ? "it" : "them"}.</p>}
          <p className="qb-muted qb-small">{avail} approved question{avail === 1 ? "" : "s"} to choose from{s.quota > avail ? ` (you asked for ${s.quota})` : ""}.</p>
        </fieldset>; })}
      <div className="qb-grid cols-2" style={{ marginTop: 12 }}>
        <div className="qb-field"><label htmlFor="bt-total">Total questions in the test</label>
          <input id="bt-total" type="number" min={sections.length} max={100} value={total} onChange={(e) => shareTotal(Number(e.target.value) || sections.length)}/>
          <span className="qb-muted qb-small">{sections.length > 1 ? "Typing a total shares it evenly between the subjects; you can then change each subject." : "The number of questions in the test."}</span></div>
        <div className="qb-field"><label htmlFor="bt-diff">Difficulty (whole test)</label>
          <select id="bt-diff" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}><option value="">Mixed (easy, medium and hard)</option><option value="easy">Easy only</option><option value="medium">Medium only</option><option value="hard">Hard only</option></select></div>
      </div>
      {problems.map((p) => <p key={p} className="qb-error" role="alert">{p}</p>)}
      {planError && <p className="qb-error" role="alert">{planError}</p>}
      {plan && <div className="qb-table-wrap"><table className="qb-table"><caption className="qb-sr-only">How the questions are shared</caption>
        <thead><tr><th>Subject and topic</th><th>Questions</th><th>Easy</th><th>Medium</th><th>Hard</th></tr></thead>
        <tbody>{plan.sections.flatMap((s) => [
          <tr key={`s-${s.position}`}><th scope="row">{s.subject}</th><th>{s.quota}</th><th colSpan={3}></th></tr>,
          ...[...s.topics].map((t) => ({ ...t, name: label(s.subject, t.topic_id) ?? t.title })).sort((a, b) => a.name.localeCompare(b.name)).map((t) => <tr key={t.topic_id}><td>&nbsp;&nbsp;{t.name}</td><td>{t.share}</td><td>{t.easy}</td><td>{t.medium}</td><td>{t.hard}</td></tr>),
        ])}</tbody>
        <tfoot><tr><th scope="row">Total</th><th>{plan.total}</th><th colSpan={3}></th></tr></tfoot></table></div>}
      {plan && <p className="qb-muted">Questions are picked when you publish, so two tests on the same topics differ. Nothing repeats within a test, and each learner will see their score for every subject and topic.</p>}
    </section>}

    {plan && <section className="qb-card"><h2>3. Details and recipients</h2>
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
        {repeatOn && <fieldset><legend>Repeat</legend>
          <label><input type="checkbox" checked={repeat && everyone} disabled={!everyone} onChange={(e) => setRepeat(e.target.checked)}/> Send a fresh copy of this to the class every week</label>
          {!everyone && <p className="qb-muted qb-small">Repeating is for the whole class. Choose &ldquo;Every learner in the class&rdquo; to use it.</p>}
          {repeat && everyone && <>
            <div className="qb-grid cols-2">
              <div className="qb-field"><label htmlFor="bt-rep-day">Every</label><select id="bt-rep-day" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>{WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></div>
              <div className="qb-field"><label htmlFor="bt-rep-time">At (Ghana time)</label><input id="bt-rep-time" type="time" value={repeatTime} onChange={(e) => setRepeatTime(e.target.value || "16:00")}/></div>
              <div className="qb-field"><label htmlFor="bt-rep-due">Learners have</label><select id="bt-rep-due" value={dueAfterDays} onChange={(e) => setDueAfterDays(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n} day{n === 1 ? "" : "s"} to finish</option>)}</select></div>
            </div>
            <p className="qb-muted qb-small">This one goes out now. The first repeat is the next {WEEKDAYS[weekday - 1]} at {repeatTime} that is at least a day away. Each repeat draws fresh questions from the same subjects and topics; if a week cannot be sent (for example a topic runs short) it is skipped and you are told. Manage them under <Link href="/teacher/assignments/repeating">Repeating assignments</Link>.</p>
          </>}
        </fieldset>}
        <button className="qb-btn" disabled={!ready || busy} onClick={() => void publish()}>{busy ? "Publishing…" : "Publish assignment"}</button>
      </div>
    </section>}
  </>;
}
