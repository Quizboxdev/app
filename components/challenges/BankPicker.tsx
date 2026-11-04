"use client";

import { useEffect, useMemo, useState } from "react";
import { getBankMenu, pullBankSections } from "@/lib/api/challenges";
import type { PracticeMenu } from "@/lib/api/practice";
import { canCombineSubjects, classLevel, MAX_TOTAL } from "@/lib/learning/blueprint";
import SubjectQuotaPicker, { pickedOrder, pickedTotal, type Picked } from "@/components/SubjectQuotaPicker";

// Add questions to a draft from the QuizBox bank: class level, one or more subjects (several only at Primary and JHS), how many from each, and optionally the topics.
// A learner's class level is their own. Pulling again adds more, so one challenge can take questions from other levels too.
export default function BankPicker({ campaignId, stage, busy, run }: { campaignId: string; stage: number; busy: boolean; run: (work: () => Promise<string | void>) => Promise<void> }) {
  const [menu, setMenu] = useState<PracticeMenu | null>(null), [grades, setGrades] = useState<string[] | null>(null), [grade, setGrade] = useState(""), [picked, setPicked] = useState<Picked>({}), [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true); setLoadError("");
    getBankMenu(grade || undefined).then((m) => { if (live) { setMenu(m); if (m.grades) setGrades(m.grades); setLoading(false); } }).catch((e: Error) => { if (live) { setLoadError(e.message); setLoading(false); } });
    return () => { live = false; };
  }, [grade]);

  const level = classLevel(menu?.grade || grade), multi = canCombineSubjects(level);
  const subjects = useMemo(() => menu?.subjects ?? [], [menu]);
  const order = useMemo(() => pickedOrder(subjects, picked), [subjects, picked]);
  const total = pickedTotal(subjects, picked);
  const problems = useMemo(() => {
    const out: string[] = [];
    if (order.length === 0) return out;
    for (const id of order) { const s = subjects.find((x) => x.id === id)!, p = picked[id];
      if (!Number.isInteger(p.quota) || p.quota < 1) out.push(`${s.name}: choose how many questions.`);
      if (p.topics && p.topics.length === 0) out.push(`${s.name}: tick at least one topic, or choose all topics.`); }
    if (total > MAX_TOTAL) out.push(`Add at most ${MAX_TOTAL} questions at a time (you have ${total}). You can add more afterwards.`);
    return out;
  }, [order, subjects, picked, total]);

  const choose = (g: string) => { setPicked({}); setGrade(g); };   // grades is null for a learner, whose class level is their own

  const add = () => run(async () => {
    const r = await pullBankSections(campaignId, order.map((id) => ({ subject: id, quota: picked[id].quota, ...(picked[id].topics ? { topic_ids: picked[id].topics! } : {}) })), menu?.grade || grade || null, stage);
    setPicked({});
    if (!r.added) return "No more matching questions were found for that choice.";
    const thin = r.sections.filter((s) => s.given < s.requested);
    return `${r.added} question${r.added === 1 ? "" : "s"} added (${r.total} in total).${thin.length ? ` ${thin.map((s) => `${s.subject}: ${s.given} of ${s.requested}`).join("; ")}. That is all the questions available for that choice.` : ""}`;
  });

  return <div>
    {loadError && <p className="qb-error" role="alert">{loadError}</p>}
    {grades !== null && <label className="qb-field">Class level
      <select value={grade} onChange={(e) => choose(e.target.value)}>
        <option value="">Choose a class level</option>
        {grades.map((g) => <option key={g} value={g}>{g}</option>)}
      </select></label>}
    {loading && !menu && <p className="qb-muted" role="status">Loading subjects…</p>}
    {menu?.grade && subjects.length === 0 && !loading && <p className="qb-muted">There are no approved questions for {menu.grade} yet.</p>}
    {menu?.grade && subjects.length > 0 && <>
      <p className="qb-muted qb-small">{multi ? `Tick one or more subjects for ${menu.grade}, and say how many questions from each.` : `Choose a subject for ${menu.grade}. Senior High challenges use one subject at a time; add again for another subject.`}</p>
      <SubjectQuotaPicker subjects={subjects} picked={picked} onChange={setPicked} multi={multi} maxTotal={MAX_TOTAL} idPrefix="bk" defaultQuota={multi ? 5 : 10} />
      {problems.map((p) => <p key={p} className="qb-error" role="alert">{p}</p>)}
      <button className="qb-btn" disabled={busy || order.length === 0 || problems.length > 0} onClick={() => void add()}>{order.length ? `Add ${total} question${total === 1 ? "" : "s"} from the bank` : "Add from the bank"}</button>
    </>}
  </div>;
}
