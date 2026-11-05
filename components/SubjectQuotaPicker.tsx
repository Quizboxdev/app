"use client";

import type { PracticeMenu } from "@/lib/api/practice";
import { splitEvenly } from "@/lib/learning/blueprint";
import { niceTitle } from "@/lib/curriculum/display";
import SubjectIcon from "@/components/SubjectIcon";

// Tick subjects, say how many questions from each and, if wanted, which topics. Shared by "Prepare across subjects" and the challenge question picker.
// With `multi` off (Senior High) ticking a subject replaces the one before it. The parent decides what the picked sections are used for.
export type Pick = { quota: number; topics: string[] | null };   // topics null = any topic of the subject
export type Picked = Record<string, Pick>;
type Subject = PracticeMenu["subjects"][number];

export const pickedOrder = (subjects: Subject[], picked: Picked) => subjects.filter((s) => picked[s.id]).map((s) => s.id);
export const pickedTotal = (subjects: Subject[], picked: Picked) => pickedOrder(subjects, picked).reduce((n, id) => n + (picked[id]?.quota ?? 0), 0);
export const availableIn = (subjects: Subject[], picked: Picked, id: string) => {
  const s = subjects.find((x) => x.id === id), p = picked[id];
  return !s || !p ? 0 : s.topics.filter((t) => !p.topics || p.topics.includes(t.id)).reduce((n, t) => n + t.available, 0);
};

// `detailsFrom` is how many subjects must be ticked before the quantity and topic boxes appear (2 to mix subjects, 1 to take questions from a single subject).
// `target`, when given, is the number of questions wanted in all: ticking subjects shares it evenly between them, and each box can still be changed.
export default function SubjectQuotaPicker({ subjects, picked, onChange, multi, maxTotal, idPrefix, defaultQuota = 5, detailsFrom = multi ? 2 : 1, target }: {
  subjects: Subject[]; picked: Picked; onChange: (next: Picked) => void; multi: boolean; maxTotal: number; idPrefix: string; defaultQuota?: number; detailsFrom?: number; target?: number;
}) {
  const order = pickedOrder(subjects, picked), total = pickedTotal(subjects, picked);
  const shared = (next: Picked): Picked => {
    if (!target || target < 1) return next;
    const ids = pickedOrder(subjects, next), q = splitEvenly(Math.min(maxTotal, target), ids.length);
    return Object.fromEntries(ids.map((id, i) => [id, { ...next[id], quota: q[i] }]));
  };
  const toggle = (id: string) => {
    if (!multi) { onChange(picked[id] ? {} : shared({ [id]: { quota: defaultQuota, topics: null } })); return; }
    const next = { ...picked };
    if (next[id]) delete next[id]; else next[id] = { quota: defaultQuota, topics: null };
    onChange(shared(next));
  };
  const setQuota = (id: string, quota: number) => onChange({ ...picked, [id]: { ...picked[id], quota: Math.max(0, Math.min(maxTotal, Math.floor(quota) || 0)) } });
  const setTopics = (id: string, topics: string[] | null) => onChange({ ...picked, [id]: { ...picked[id], topics } });
  const shareTotal = (n: number) => {
    const q = splitEvenly(Math.max(order.length, Math.min(maxTotal, n)), order.length);
    onChange(Object.fromEntries(Object.entries(picked).map(([id, p]) => [id, { ...p, quota: q[order.indexOf(id)] }])));
  };
  const showDetails = order.length >= detailsFrom;

  return <>
    <div className="qb-chip-row" role="group" aria-label={multi ? "Subjects to mix" : "Subject"}>
      {subjects.map((s) => <button type="button" key={s.id} className="qb-chip" aria-pressed={!!picked[s.id]} onClick={() => toggle(s.id)}><SubjectIcon name={s.name} size={22} />&nbsp;{s.name} <span className="qb-muted">&nbsp;({s.available})</span></button>)}
    </div>
    {multi && detailsFrom > 1 && order.length === 1 && <p className="qb-muted qb-small">Tick one more subject to mix them.</p>}
    {showDetails && <>
      {order.map((id) => { const s = subjects.find((x) => x.id === id)!, p = picked[id], avail = availableIn(subjects, picked, id);
        return <fieldset key={id} className="qb-card" style={{ marginTop: 12 }}>
          <legend><strong>{s.name}</strong></legend>
          <div className="qb-field"><label htmlFor={`${idPrefix}-q-${id}`}>Questions from {s.name}</label>
            <input id={`${idPrefix}-q-${id}`} type="number" min={1} max={maxTotal} value={p.quota} onChange={(e) => setQuota(id, Number(e.target.value))}/></div>
          <div role="radiogroup" aria-label={`Topics for ${s.name}`}>
            <label><input type="radio" name={`${idPrefix}-m-${id}`} checked={p.topics === null} onChange={() => setTopics(id, null)}/> All topics</label>{" "}
            <label><input type="radio" name={`${idPrefix}-m-${id}`} checked={p.topics !== null} onChange={() => setTopics(id, s.topics.map((t) => t.id))}/> Choose topics</label>
          </div>
          {p.topics && <ul className="qb-task-list">{s.topics.map((t) => <li key={t.id}><label><input type="checkbox" checked={p.topics!.includes(t.id)}
            onChange={(e) => setTopics(id, e.target.checked ? [...p.topics!, t.id] : p.topics!.filter((x) => x !== t.id))}/> {niceTitle(t.title)} <span className="qb-muted">({t.available} questions)</span></label></li>)}</ul>}
          <p className="qb-muted qb-small">{avail} question{avail === 1 ? "" : "s"} to choose from{p.quota > avail ? ` (you asked for ${p.quota})` : ""}.</p>
        </fieldset>; })}
      {multi && order.length > 1 && <div className="qb-field" style={{ marginTop: 12 }}><label htmlFor={`${idPrefix}-total`}>Total questions</label>
        <input id={`${idPrefix}-total`} type="number" min={order.length} max={maxTotal} value={total} onChange={(e) => shareTotal(Number(e.target.value) || order.length)}/>
        <span className="qb-muted qb-small">Typing a total shares it evenly between the subjects; you can then change each one.</span></div>}
    </>}
  </>;
}
