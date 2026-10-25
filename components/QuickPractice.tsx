"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Shuffle, ListChecks, GraduationCap } from "lucide-react";
import { buildQuickPractice, buildStudySession, countChoices, getPracticeMenu, getTopicProgress, type PracticeMenu, type TopicProgress } from "@/lib/api/practice";
import { startAttempt } from "@/lib/api/assessment";
import { gradeSort } from "@/lib/sme/catalogue";
import { getMyAccess, isAllowanceExhausted, SUBSCRIBE_PATH, type MyAccess } from "@/lib/api/access";
import SubjectIcon from "@/components/SubjectIcon";
import { useDraft } from "@/lib/drafts/use-draft";
import DraftNotice from "@/components/DraftNotice";
import KnowledgeWindow, { KnowledgeWindowGrid } from "@/components/qinsignia/KnowledgeWindow";
import { useWorkspaceFlags } from "@/components/WorkspaceProvider";
import { subjectCardView } from "@/lib/learning/subject-card-state";

// One short screen for learners and teachers alike: subject, then either a random mix or ticked topics, then how many questions, Start.
// No strands, sub-strands, levels or codes are shown; topics are plain sub-strand names with their question counts. Teachers and admins
// first choose the grade they are working on; a learner's grade comes from their profile and is enforced on the server.
export default function QuickPractice() {
  const router = useRouter();
  const flags = useWorkspaceFlags();
  const [menu, setMenu] = useState<PracticeMenu | null>(null), [grade, setGrade] = useState(""), [subjectId, setSubjectId] = useState("");
  const [mode, setMode] = useState<"random" | "topics" | "study">("random"), [ticked, setTicked] = useState<string[]>([]), [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");

  const [access, setAccess] = useState<MyAccess | null>(null);
  const [studyTopic, setStudyTopic] = useState(""), [progress, setProgress] = useState<Record<string, TopicProgress>>({});
  useEffect(() => { getMyAccess().then(setAccess); }, []);
  const load = (g?: string) => { setMenu(null); getPracticeMenu(g).then(setMenu).catch((e) => { setError(e.message); setMenu({ grade: "", subjects: [] }); }); };
  useEffect(() => { load(); }, []);
  const subject = menu?.subjects.find((s) => s.id === subjectId);
  const effective = useMemo(() => subject ? (mode === "random" ? subject.topics.map((t) => t.id) : mode === "study" ? (studyTopic ? [studyTopic] : []) : ticked) : [], [subject, mode, ticked, studyTopic]);
  const pool = useMemo(() => subject ? subject.topics.filter((t) => effective.includes(t.id)).reduce((n, t) => n + t.available, 0) : 0, [subject, effective]);
  const choices = countChoices(pool);
  // The choices made so far are kept as a draft, so leaving the page by mistake does not lose them.
  type Held = { grade: string; subjectId: string; mode: "random" | "topics" | "study"; ticked: string[]; studyTopic: string; count: number };
  const draft = useDraft<Held>({ kind: "practice", title: subject?.name ?? "Practice set", path: "/practise", value: { grade, subjectId, mode, ticked, studyTopic, count }, ready: menu !== null,
    empty: !subjectId, apply: (v) => { if (v.grade && menu?.grades) { setGrade(v.grade); load(v.grade); } setSubjectId(v.subjectId ?? ""); setMode(v.mode ?? "random"); setTicked(v.ticked ?? []); setStudyTopic(v.studyTopic ?? ""); if (v.count) setCount(v.count); } });
  useEffect(() => {
    if (!flags.q_insignia_subject_cards_v02 || !menu || subjectId || typeof window === "undefined") return;
    const want = new URLSearchParams(window.location.search).get("pick");
    if (want && menu.subjects.some((s) => s.id === want)) pick(want);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when the menu arrives
  }, [menu, flags.q_insignia_subject_cards_v02]);
  useEffect(() => { if (choices.length && !choices.includes(count)) setCount(choices.includes(10) ? 10 : choices[choices.length - 1]); }, [choices, count]);

  const pick = (id: string) => { setSubjectId(id); setTicked([]); setStudyTopic(""); setMode("random"); setNote(""); setError(""); const s = menu?.subjects.find((x) => x.id === id); if (s) void getTopicProgress(s.topics.map((t) => t.id)).then(setProgress); };
  async function start() {
    if (!subject || !effective.length || busy) return;
    // Free allowance used up: the attempt goes to the subscription page instead of starting.
    if (access?.exhausted) { router.push(SUBSCRIBE_PATH); return; }
    setBusy(true); setError(""); setNote("");
    try {
      void draft.finish();
      const built = mode === "study" ? await buildStudySession(studyTopic, count, grade || undefined) : await buildQuickPractice(effective, count, grade || undefined);
      if (built.short) setNote(`Only ${built.question_count} questions are available for this choice, so that is what you get.`);
      // Teachers and admins read their set with answers (attempts are for learners).
      if (menu?.grades) { router.push(`/practise/preview/${built.assessment_id}`); return; }
      const attempt = await startAttempt({ assessmentId: built.assessment_id }) as { attempt_id: string };
      router.push(`/student/attempt/${attempt.attempt_id}`);
    } catch (e: any) {
      if (isAllowanceExhausted(e)) { router.push(SUBSCRIBE_PATH); return; }
      setError(e?.message ?? "Could not start practice."); setBusy(false);
    }
  }

  if (menu === null) return <section className="qb-card qb-skeleton" aria-busy="true" style={{ minHeight: 120 }} />;
  // Teachers and admins: pick the grade first (the server lists the grades that exist for their market).
  if (menu.grades && !menu.grade) return <section className="qb-card"><h2>Build practice questions</h2>
    <p className="qb-muted">Choose the grade you are working on.</p>
    {error && <p className="qb-error" role="alert">{error}</p>}
    <div className="qb-chip-row" role="group" aria-label="Grade">{[...menu.grades].sort(gradeSort).map((g) => <button type="button" key={g} className="qb-chip" onClick={() => { setGrade(g); load(g); }}>{g}</button>)}</div>
    {!menu.grades.length && <p className="qb-muted">No grades are published for your market yet.</p>}</section>;
  if (!menu.subjects.length) return <section className="qb-card"><h2>Build your practice</h2>
    {error ? <p className="qb-error" role="alert">{error}</p> : <p className="qb-muted">Questions for {menu.grade || "your class"} are being added. Check back soon.</p>}</section>;
  return <><DraftNotice restored={!!draft.restored} expiresAt={draft.expiresAt} noun="practice set" onDiscard={() => void draft.finish()} />
  <section className="qb-card" aria-labelledby="qp-title">
    <h2 id="qp-title">Build your practice{menu.grade ? ` · ${menu.grade}` : ""}</h2>
    {error && <p className="qb-error" role="alert">{error}</p>}{note && <p role="status">{note}</p>}
    {access?.gated && !access.subscribed && <p className="qb-small qb-muted" role="status">{access.exhausted ? "Your free practice is used up. Starting will take you to subscribe." : `${access.remaining} free practice ${access.remaining === 1 ? "session" : "sessions"} left.`}</p>}

    <h3>1. Subject</h3>
    {flags.q_insignia_subject_cards_v02 ? <KnowledgeWindowGrid label="Subject">
      {menu.subjects.map((s) => <KnowledgeWindow key={s.id} variant="selector" name={s.name} selected={subjectId === s.id} onSelect={() => pick(s.id)}
        meta={`${s.available} question${s.available === 1 ? "" : "s"} · ${s.topics.length} topic${s.topics.length === 1 ? "" : "s"}`}
        view={(() => { const v = subjectCardView({ available: s.available }); return v.state === "CONTENT_UNAVAILABLE" ? v : { ...v, status: null }; })()} />)}
    </KnowledgeWindowGrid> : <div className="qb-chip-row" role="group" aria-label="Subject">
      {menu.subjects.map((s) => <button type="button" key={s.id} className="qb-chip" aria-pressed={subjectId === s.id} onClick={() => pick(s.id)}><SubjectIcon name={s.name} size={22} />&nbsp;{s.name} <span className="qb-muted">&nbsp;({s.available})</span></button>)}
    </div>}

    {subject && <>
      <h3 style={{ marginTop: 14 }}>2. What to practise</h3>
      <div className="qb-chip-row" role="group" aria-label="Mode">
        <button type="button" className="qb-chip" aria-pressed={mode === "random"} onClick={() => setMode("random")}><Shuffle size={14} aria-hidden="true" /> Random mix</button>
        <button type="button" className="qb-chip" aria-pressed={mode === "topics"} onClick={() => { setMode("topics"); if (!ticked.length) setTicked(subject.topics.map((t) => t.id)); }}><ListChecks size={14} aria-hidden="true" /> Choose topics</button>
        <button type="button" className="qb-chip" aria-pressed={mode === "study"} onClick={() => setMode("study")}><GraduationCap size={14} aria-hidden="true" /> Study a topic</button>
      </div>
      {mode === "topics" && <>
        <label className="qb-small" style={{ display: "block", margin: "10px 0 6px" }}><input type="checkbox" checked={ticked.length === subject.topics.length}
          onChange={(e) => setTicked(e.target.checked ? subject.topics.map((t) => t.id) : [])}/> All topics</label>
        <ul className="qb-task-list">
          {subject.topics.map((t) => <li key={t.id}><label><input type="checkbox" checked={ticked.includes(t.id)}
            onChange={(e) => setTicked(e.target.checked ? [...ticked, t.id] : ticked.filter((x) => x !== t.id))}/> {t.title} <span className="qb-muted">({t.available} questions)</span></label></li>)}
        </ul>
      </>}
      {mode === "study" && <>
        <p className="qb-small qb-muted" style={{ margin: "10px 0 6px" }}>Pick one topic. Questions go from easy to hard and you see the explanation after each answer. New questions come first.</p>
        <ul className="qb-task-list">
          {subject.topics.map((t) => { const pr = progress[t.id]; const pct = pr && pr.total ? Math.round((pr.answered / pr.total) * 100) : 0;
            return <li key={t.id}><label style={{ display: "grid", gap: 4, width: "100%" }}>
              <span><input type="radio" name="study-topic" checked={studyTopic === t.id} onChange={() => setStudyTopic(t.id)} /> {t.title} <span className="qb-muted">({t.available} questions)</span></span>
              {pr && pr.answered > 0 && <span className="qb-small qb-muted" style={{ display: "grid", gap: 4 }}>
                <span className="qb-progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.title} answered`}><span className="qb-progress-fill" style={{ width: `${pct}%`, display: "block", height: "100%" }} /></span>
                {pr.answered} of {pr.total} answered, {pr.correct} correct</span>}
            </label></li>; })}
        </ul>
      </>}

      <h3 style={{ marginTop: 14 }}>3. How many questions?</h3>
      {choices.length === 0 ? <p className="qb-muted">{mode === "study" ? "Pick a topic to study." : "Tick at least one topic that has questions."}</p> :
        <div className="qb-chip-row" role="group" aria-label="Number of questions">
          {choices.map((n) => <button type="button" key={n} className="qb-chip" aria-pressed={count === n} onClick={() => setCount(n)}>{n}</button>)}
        </div>}

      <div style={{ marginTop: 16 }}>
        <button className="qb-btn" disabled={busy || !choices.length} onClick={() => void start()}><Play size={14} aria-hidden="true" /> {busy ? "Getting your questions…" : mode === "study" ? `Start studying ${choices.length ? count : ""} questions` : `Start ${choices.length ? count : ""} questions`}</button>
      </div>
    </>}
  </section></>;
}
