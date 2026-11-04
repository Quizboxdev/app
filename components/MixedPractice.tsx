"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Play } from "lucide-react";
import { buildMixedPractice, getPracticeMenu, MAX_PRACTICE_QUESTIONS, MIN_PRACTICE_QUESTIONS, type PracticeMenu } from "@/lib/api/practice";
import { startAttempt } from "@/lib/api/assessment";
import { getMyAccess, isAllowanceExhausted, SUBSCRIBE_PATH, type MyAccess } from "@/lib/api/access";
import { canCombineSubjects, classLevel } from "@/lib/learning/blueprint";
import SubjectQuotaPicker, { pickedOrder, pickedTotal, type Picked } from "@/components/SubjectQuotaPicker";

const MIN_TOTAL = MIN_PRACTICE_QUESTIONS, MAX_TOTAL = MAX_PRACTICE_QUESTIONS;

// Prepare across subjects (Primary and JHS learners): tick two or more subjects, say how many questions from each and, if you like, which topics.
// One practice set is built from all of them and the result page shows how you did in each subject and topic.
export default function MixedPractice() {
  const router = useRouter();
  const [menu, setMenu] = useState<PracticeMenu | null>(null), [access, setAccess] = useState<MyAccess | null>(null);
  const [picked, setPicked] = useState<Picked>({}), [bySubject, setBySubject] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");
  useEffect(() => { getPracticeMenu().then(setMenu).catch(() => setMenu({ grade: "", subjects: [] })); getMyAccess().then(setAccess).catch(() => undefined); }, []);

  const order = useMemo(() => pickedOrder(menu?.subjects ?? [], picked), [menu, picked]);
  const total = pickedTotal(menu?.subjects ?? [], picked);
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
    <SubjectQuotaPicker subjects={menu.subjects} picked={picked} onChange={setPicked} multi maxTotal={MAX_TOTAL} idPrefix="mx" />
    {order.length >= 2 && <>
      <label className="qb-small" style={{ display: "block", marginTop: 8 }}><input type="checkbox" checked={bySubject} onChange={(e) => setBySubject(e.target.checked)}/> Keep each subject together, like a paper (otherwise the questions are mixed)</label>
      {problems.map((p) => <p key={p} className="qb-error" role="alert">{p}</p>)}
      {access?.gated && !access.subscribed && <p className="qb-small qb-muted" role="status">{access.exhausted ? "Your free practice is used up. Starting will take you to subscribe." : `${access.remaining} free practice ${access.remaining === 1 ? "session" : "sessions"} left.`}</p>}
      <div style={{ marginTop: 16 }}><button className="qb-btn" disabled={busy || problems.length > 0} onClick={() => void start()}><Play size={14} aria-hidden="true" /> {busy ? "Getting your questions…" : `Start ${total} questions`}</button></div>
    </>}
  </section>;
}
