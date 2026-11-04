"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Play } from "lucide-react";
import { buildMixedPractice, getPracticeMenu, MAX_PRACTICE_QUESTIONS, MIN_PRACTICE_QUESTIONS, type PracticeMenu } from "@/lib/api/practice";
import { startAttempt } from "@/lib/api/assessment";
import { getMyAccess, isAllowanceExhausted, SUBSCRIBE_PATH, type MyAccess } from "@/lib/api/access";
import { canCombineSubjects, classLevel, splitEvenly } from "@/lib/learning/blueprint";
import { niceTitle } from "@/lib/curriculum/display";
import SubjectIcon from "@/components/SubjectIcon";

type Pick = { quota: number; topics: string[] | null };   // topics null = any topic of the subject
const MIN_TOTAL = MIN_PRACTICE_QUESTIONS, MAX_TOTAL = MAX_PRACTICE_QUESTIONS;

// Prepare across subjects (Primary and JHS learners): tick two or more subjects, say how many questions from each and, if you like, which topics.
// One practice set is built from all of them and the result page shows how you did in each subject and topic.
export default function MixedPractice() {
  const router = useRouter();
  const [menu, setMenu] = useState<PracticeMenu | null>(null), [access, setAccess] = useState<MyAccess | null>(null);
  const [picked, setPicked] = useState<Record<string, Pick>>({}), [bySubject, setBySubject] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");
  useEffect(() => { getPracticeMenu().then(setMenu).catch(() => setMenu({ grade: "", subjects: [] })); getMyAccess().then(setAccess).catch(() => undefined); }, []);

  const order = useMemo(() => (menu?.subjects ?? []).filter((s) => picked[s.id]).map((s) => s.id), [menu, picked]);
  const total = order.reduce((n, id) => n + (picked[id]?.quota ?? 0), 0);
  const availableOf = (id: string) => { const s = menu?.subjects.find((x) => x.id === id), p = picked[id]; if (!s || !p) return 0; return s.topics.filter((t) => !p.topics || p.topics.includes(t.id)).reduce((n, t) => n + t.available, 0); };
  const problems = useMemo(() => {
    const out: string[] = [];
    if (order.length < 2) return out;
    if (total < MIN_TOTAL) out.push(`Choose at least ${MIN_TOTAL} questions in all.`);
    if (total > MAX_TOTAL) out.push(`A practice set has at most ${MAX_TOTAL} questions in all.`);
    for (const id of order) { const s = menu!.subjects.find((x) => x.id === id)!, p = picked[id];
      if (!Number.isInteger(p.quota) || p.quota < 1) out.push(`${s.name}: choose how many questions.`);
      if (p.topics && p.topics.length === 0) out.push(`${s.name}: tick at least one topic, or choose all topics.`); }
    return out;
  }, [order, total, menu, picked]);

  // Only learners at Primary or JHS mix subjects (a Senior High learner practises one subject at a time), and only when there is something to mix.
  if (!menu || menu.grades || !canCombineSubjects(classLevel(menu.grade)) || menu.subjects.length < 2) return null;

  const toggle = (id: string) => setPicked((cur) => {
    const next = { ...cur };
    if (next[id]) delete next[id]; else next[id] = { quota: 5, topics: null };
    return next;
  });
  const setQuota = (id: string, quota: number) => setPicked((cur) => ({ ...cur, [id]: { ...cur[id], quota: Math.max(0, Math.min(MAX_TOTAL, Math.floor(quota) || 0)) } }));
  const shareTotal = (n: number) => { const q = splitEvenly(Math.max(order.length, Math.min(MAX_TOTAL, n)), order.length); setPicked((cur) => Object.fromEntries(Object.entries(cur).map(([id, p]) => [id, { ...p, quota: q[order.indexOf(id)] }]))); };
  const setTopics = (id: string, topics: string[] | null) => setPicked((cur) => ({ ...cur, [id]: { ...cur[id], topics } }));

  async function start() {
    if (order.length < 2 || problems.length || busy) return;
    if (access?.exhausted) { router.push(SUBSCRIBE_PATH); return; }
    setBusy(true); setError(""); setNote("");
    try {
      const built = await buildMixedPractice(order.map((id) => ({ subject: id, quota: picked[id].quota, ...(picked[id].topics ? { topic_ids: picked[id].topics! } : {}) })), bySubject ? "BY_SUBJECT" : "MIXED");
      const thin = built.sections.filter((s) => s.given < s.requested);
      if (thin.length) setNote(`${thin.map((s) => `${s.subject}: ${s.given} of ${s.requested}`).join("; ")}. That is all the questions available for that choice.`);
      const attempt = await startAttempt({ assessmentId: built.assessment_id }) as { attempt_id: string };
      router.push(`/student/attempt/${attempt.attempt_id}`);
    } catch (e: any) {
      if (isAllowanceExhausted(e)) { router.push(SUBSCRIBE_PATH); return; }
      setError(e?.message ?? "Could not start practice."); setBusy(false);
    }
  }

  return <section className="qb-card" aria-labelledby="mx-title" style={{ marginTop: 16 }}>
    <h2 id="mx-title"><Layers size={18} aria-hidden="true" /> Prepare across subjects{menu.grade ? ` · ${menu.grade}` : ""}</h2>
    <p className="qb-muted">Getting ready for a test with more than one subject? Tick two or more subjects and choose how many questions from each. Afterwards you will see how you did in each subject and topic, and where to do better.</p>
    {error && <p className="qb-error" role="alert">{error}</p>}{note && <p role="status">{note}</p>}
    <div className="qb-chip-row" role="group" aria-label="Subjects to mix">
      {menu.subjects.map((s) => <button type="button" key={s.id} className="qb-chip" aria-pressed={!!picked[s.id]} onClick={() => toggle(s.id)}><SubjectIcon name={s.name} size={22} />&nbsp;{s.name} <span className="qb-muted">&nbsp;({s.available})</span></button>)}
    </div>
    {order.length === 1 && <p className="qb-muted qb-small">Tick one more subject to mix them.</p>}
    {order.length >= 2 && <>
      {order.map((id) => { const s = menu.subjects.find((x) => x.id === id)!, p = picked[id], avail = availableOf(id);
        return <fieldset key={id} className="qb-card" style={{ marginTop: 12 }}>
          <legend><strong>{s.name}</strong></legend>
          <div className="qb-field"><label htmlFor={`mx-q-${id}`}>Questions from {s.name}</label>
            <input id={`mx-q-${id}`} type="number" min={1} max={MAX_TOTAL} value={p.quota} onChange={(e) => setQuota(id, Number(e.target.value))}/></div>
          <div role="radiogroup" aria-label={`Topics for ${s.name}`}>
            <label><input type="radio" name={`mx-m-${id}`} checked={p.topics === null} onChange={() => setTopics(id, null)}/> All topics</label>{" "}
            <label><input type="radio" name={`mx-m-${id}`} checked={p.topics !== null} onChange={() => setTopics(id, s.topics.map((t) => t.id))}/> Choose topics</label>
          </div>
          {p.topics && <ul className="qb-task-list">{s.topics.map((t) => <li key={t.id}><label><input type="checkbox" checked={p.topics!.includes(t.id)}
            onChange={(e) => setTopics(id, e.target.checked ? [...p.topics!, t.id] : p.topics!.filter((x) => x !== t.id))}/> {niceTitle(t.title)} <span className="qb-muted">({t.available} questions)</span></label></li>)}</ul>}
          <p className="qb-muted qb-small">{avail} question{avail === 1 ? "" : "s"} to choose from{p.quota > avail ? ` (you asked for ${p.quota})` : ""}.</p>
        </fieldset>; })}
      <div className="qb-field" style={{ marginTop: 12 }}><label htmlFor="mx-total">Total questions</label>
        <input id="mx-total" type="number" min={order.length} max={MAX_TOTAL} value={total} onChange={(e) => shareTotal(Number(e.target.value) || order.length)}/>
        <span className="qb-muted qb-small">Typing a total shares it evenly between the subjects; you can then change each one.</span></div>
      <label className="qb-small" style={{ display: "block", marginTop: 8 }}><input type="checkbox" checked={bySubject} onChange={(e) => setBySubject(e.target.checked)}/> Keep each subject together, like a paper (otherwise the questions are mixed)</label>
      {problems.map((p) => <p key={p} className="qb-error" role="alert">{p}</p>)}
      {access?.gated && !access.subscribed && <p className="qb-small qb-muted" role="status">{access.exhausted ? "Your free practice is used up. Starting will take you to subscribe." : `${access.remaining} free practice ${access.remaining === 1 ? "session" : "sessions"} left.`}</p>}
      <div style={{ marginTop: 16 }}><button className="qb-btn" disabled={busy || problems.length > 0} onClick={() => void start()}><Play size={14} aria-hidden="true" /> {busy ? "Getting your questions…" : `Start ${total} questions`}</button></div>
    </>}
  </section>;
}
