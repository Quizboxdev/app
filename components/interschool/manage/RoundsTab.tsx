"use client";

import { useEffect, useState } from "react";
import { setDivisions, setRounds, subjectsFor, topicsFor } from "@/lib/api/interschool";
import { Notice, Row, useAction } from "../ui";
import { LEVELS, blankRound, cleanRound, copyRounds, fromInput, questionTotal, splitEqually, toInput, wholeOrNull } from "@/lib/interschool/wizard";
import { RULE, levelName } from "@/lib/interschool/text";
import type { Division, Managed, RoundConfig, Section } from "@/lib/interschool/types";

type Subject = { id: string; title: string; level: string; questions: number };
type Draft = { title: string; level_codes: string[]; mixed: boolean; capacity: number | null };

// Class-level divisions, and each division's rounds: subjects, topics, question numbers, difficulty, timing and who goes through.
export default function RoundsTab({ c, reload }: { c: Managed; reload: () => Promise<unknown> }) {
  const editable = c.status === "DRAFT" || c.status === "PENDING_APPROVAL";
  const act = useAction(reload);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  useEffect(() => setDrafts(c.divisions.map((d) => ({ title: d.title, level_codes: d.level_codes, mixed: d.mixed, capacity: d.capacity }))), [c]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const levels = Array.from(new Set(c.divisions.flatMap((d) => d.level_codes))).join(",");
  useEffect(() => { if (levels && editable) subjectsFor(levels.split(",")).then(setSubjects).catch(() => setSubjects([])); }, [levels, editable]);
  const hasRounds = c.divisions.some((d) => d.rounds.length > 0);
  const edit = (i: number, patch: Partial<Draft>) => setDrafts((all) => all.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  return (
    <>
      <Notice error={act.error} done={act.done} />
      <div className="qb-card">
        <h2>Divisions</h2>
        <p className="qb-muted">Each division has its own schools&apos; learners, questions, fixtures, rounds, rankings and winners.</p>
        {drafts.map((d, i) => (
          <fieldset key={i} disabled={!editable} style={{ marginBottom: 12 }}><legend>Division {i + 1}</legend>
            <Row><label>Name <input value={d.title} maxLength={80} onChange={(e) => edit(i, { title: e.target.value })} /></label>
              <label>Capacity <input type="number" min={1} style={{ width: 100 }} value={d.capacity ?? ""} onChange={(e) => edit(i, { capacity: wholeOrNull(e.target.value) || null })} /></label>
              <label className="qb-check"><input type="checkbox" checked={d.mixed} onChange={(e) => edit(i, { mixed: e.target.checked, level_codes: e.target.checked ? d.level_codes : d.level_codes.slice(0, 1) })} /> Mix levels</label>
              {editable && <button type="button" className="qb-link-btn" onClick={() => setDrafts(drafts.filter((_, k) => k !== i))}>Remove</button>}</Row>
            <Row>{LEVELS.map((l) => <label key={l} className="qb-check"><input type={d.mixed ? "checkbox" : "radio"} name={`level-${i}`} checked={d.level_codes.includes(l)} onChange={(e) => edit(i, { level_codes: d.mixed ? (e.target.checked ? [...d.level_codes, l] : d.level_codes.filter((x) => x !== l)) : [l], title: !d.mixed && (!d.title || d.level_codes.map(levelName).includes(d.title)) ? levelName(l) : d.title })} /> {levelName(l)}</label>)}</Row>
          </fieldset>))}
        {editable && <Row>
          <button type="button" className="qb-btn qb-btn-secondary" onClick={() => setDrafts([...drafts, { title: "", level_codes: [], mixed: false, capacity: null }])}>Add a division</button>
          <button type="button" className="qb-btn" disabled={act.busy || drafts.length === 0 || drafts.some((d) => !d.level_codes.length)} onClick={() => { if (!hasRounds || window.confirm("Saving divisions removes the rounds already set. Continue?")) void act.run(() => setDivisions(c.id, drafts), "Divisions saved. Now set each division's rounds."); }}>Save divisions</button>
        </Row>}
      </div>
      {c.divisions.map((d) => <DivisionRounds key={d.id} c={c} d={d} subjects={subjects} editable={editable} reload={reload} />)}
    </>
  );
}

function DivisionRounds({ c, d, subjects, editable, reload }: { c: Managed; d: Division; subjects: Subject[]; editable: boolean; reload: () => Promise<unknown> }) {
  const [rounds, set] = useState<RoundConfig[]>(d.rounds);
  useEffect(() => set(d.rounds), [d]);
  const act = useAction(reload);
  const mine = subjects.filter((s) => d.level_codes.includes(s.level));
  const edit = (i: number, patch: Partial<RoundConfig>) => set((all) => all.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const others = c.divisions.filter((x) => x.id !== d.id);
  return (
    <div className="qb-card">
      <h2>{d.title}: rounds</h2>
      <Notice error={act.error} done={act.done} />
      {!editable && rounds.map((r, i) => <p key={i}><strong>{r.title}</strong> · {questionTotal(r.sections)} questions · {Math.round(r.duration_seconds / 60)} minutes · {r.format.replaceAll("_", " ").toLowerCase()} · {RULE[r.rule]}{r.frozen ? " · paper frozen" : ""}</p>)}
      {editable && rounds.map((r, i) => (
        <fieldset key={i} style={{ marginBottom: 16 }}><legend>Round {i + 1}</legend>
          <Row>
            <label>Name <input value={r.title} maxLength={80} onChange={(e) => edit(i, { title: e.target.value })} /></label>
            <label>Format <select value={r.format} onChange={(e) => { const format = e.target.value as RoundConfig["format"]; edit(i, { format, stage: format === "GROUP" ? "GROUP" : r.stage, rule: format === "FIELD" && r.rule === "FIXTURE_WINNERS" ? "ALL" : format === "KNOCKOUT" ? "FIXTURE_WINNERS" : r.rule }); }}><option value="FIELD">Everyone sits together</option><option value="ROUND_ROBIN">Round robin match day</option><option value="GROUP">Group match day</option><option value="KNOCKOUT">Knockout</option></select></label>
            <label>Stage <select value={r.stage} onChange={(e) => edit(i, { stage: e.target.value })}><option value="ROUND">Round</option><option value="PRELIMINARY">Preliminary</option><option value="GROUP">Group stage</option><option value="QUARTER_FINAL">Quarter-final</option><option value="SEMI_FINAL">Semi-final</option><option value="FINAL">Final</option></select></label>
            <button type="button" className="qb-link-btn" onClick={() => set(rounds.filter((_, k) => k !== i))}>Remove round</button>
          </Row>
          <Row>
            <label>Opens (GMT) <input type="datetime-local" value={toInput(r.opens_at)} onChange={(e) => edit(i, { opens_at: fromInput(e.target.value) ?? r.opens_at })} /></label>
            <label>Closes (GMT) <input type="datetime-local" value={toInput(r.closes_at)} onChange={(e) => edit(i, { closes_at: fromInput(e.target.value) ?? r.closes_at })} /></label>
            <label>Minutes <input type="number" min={1} max={240} style={{ width: 90 }} value={Math.round(r.duration_seconds / 60)} onChange={(e) => edit(i, { duration_seconds: (wholeOrNull(e.target.value) ?? 1) * 60 })} /></label>
          </Row>
          {r.sections.map((s, k) => <SectionRow key={k} s={s} subjects={mine} onChange={(next) => edit(i, { sections: r.sections.map((x, j) => (j === k ? next : x)) })} onRemove={() => edit(i, { sections: r.sections.filter((_, j) => j !== k) })} />)}
          <Row>
            <button type="button" className="qb-btn qb-btn-secondary" disabled={mine.length === 0} onClick={() => { const next = mine.find((m) => !r.sections.some((s) => s.subject_id === m.id)); if (next) edit(i, { sections: [...r.sections, { subject_id: next.id, count: 10 }] }); }}>Add a subject</button>
            {r.sections.length > 1 && <button type="button" className="qb-link-btn" onClick={() => edit(i, { sections: splitEqually(questionTotal(r.sections), r.sections.map((s) => s.subject_id)).map((x) => ({ ...r.sections.find((s) => s.subject_id === x.subject_id)!, count: x.count, difficulty: undefined })) })}>Split questions equally</button>}
            <strong>{questionTotal(r.sections)} questions</strong>
          </Row>
          <Row>
            <label>Who goes through <select value={r.rule} onChange={(e) => edit(i, { rule: e.target.value as RoundConfig["rule"] })}>{Object.entries(RULE).filter(([k]) => k !== "FIXTURE_WINNERS" || r.format !== "FIELD").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            {["PASS", "PASS_AND_TOP_LEARNERS", "TOP_LEARNERS", "TOP_SCHOOLS", "FIXTURE_WINNERS"].includes(r.rule) && <label>Pass mark % {["PASS", "PASS_AND_TOP_LEARNERS"].includes(r.rule) ? "" : "(optional)"} <input type="number" min={0} max={100} style={{ width: 90 }} value={r.pass_percent ?? ""} onChange={(e) => edit(i, { pass_percent: wholeOrNull(e.target.value) })} /></label>}
            {["TOP_LEARNERS", "TOP_SCHOOLS", "PASS_AND_TOP_LEARNERS"].includes(r.rule) && <label>How many <input type="number" min={1} style={{ width: 90 }} value={r.top_n ?? ""} onChange={(e) => edit(i, { top_n: wholeOrNull(e.target.value) })} /></label>}
          </Row>
        </fieldset>))}
      {editable && <Row>
        <button type="button" className="qb-btn qb-btn-secondary" onClick={() => set([...rounds, blankRound(rounds.length + 1, rounds.at(-1)?.closes_at ?? null, c.opens_at)])}>Add a round</button>
        <button type="button" className="qb-btn" disabled={act.busy || rounds.length === 0 || rounds.some((r) => r.sections.length === 0)} onClick={() => void act.run(() => setRounds(d.id, rounds.map(cleanRound)), "Rounds saved.")}>Save rounds</button>
        {others.length > 0 && d.rounds.length > 0 && <button type="button" className="qb-link-btn" disabled={act.busy} onClick={() => { if (!window.confirm(`Replace the rounds of ${others.map((o) => o.title).join(", ")} with these (same subjects, whole subjects)?`)) return; void act.run(async () => { const gaps: string[] = []; for (const o of others) { const copy = copyRounds(d, subjects, o); if (copy.missing.length) gaps.push(`${o.title}: no ${copy.missing.join(", ")}`); if (copy.rounds.every((r) => r.sections.length)) await setRounds(o.id, copy.rounds); } if (gaps.length) throw new Error(`Copied where possible. ${gaps.join("; ")}`); }, "Rounds copied to the other divisions."); }}>Copy to the other divisions</button>}
      </Row>}
    </div>
  );
}

type Topic = { id: string; title: string; code: string; type: string; questions: number };
// Strands, then whatever sits under them down to single indicators. A tick takes that part and everything under it.
function TopicList({ subject, parent, chosen, toggle }: { subject: string; parent: string | null; chosen: string[]; toggle: (id: string, on: boolean) => void }) {
  const [topics, setTopics] = useState<Topic[] | null>(null), [open, setOpen] = useState<string[]>([]);
  useEffect(() => { setTopics(null); topicsFor(subject, parent).then(setTopics).catch(() => setTopics([])); }, [subject, parent]);
  if (topics === null) return <span className="qb-muted">Loading topics…</span>;
  if (topics.length === 0) return <span className="qb-muted qb-small">Nothing further under this.</span>;
  return (
    <div style={{ display: "grid", gap: 4, paddingLeft: 16 }}>
      {topics.map((t) => <div key={t.id}>
        <label className="qb-check"><input type="checkbox" checked={chosen.includes(t.id)} onChange={(e) => toggle(t.id, e.target.checked)} /> {t.title} <span className="qb-muted">({t.questions})</span></label>
        {t.type !== "learning_indicator" && <button type="button" className="qb-link-btn" aria-expanded={open.includes(t.id)} onClick={() => setOpen(open.includes(t.id) ? open.filter((x) => x !== t.id) : [...open, t.id])}>{open.includes(t.id) ? "Hide parts" : "Show parts"}</button>}
        {open.includes(t.id) && <TopicList subject={subject} parent={t.id} chosen={chosen} toggle={toggle} />}
      </div>)}
    </div>
  );
}

function SectionRow({ s, subjects, onChange, onRemove }: { s: Section; subjects: Subject[]; onChange: (s: Section) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(Boolean(s.node_ids?.length));
  const subject = subjects.find((x) => x.id === s.subject_id);
  const mix = s.difficulty;
  return (
    <div style={{ borderTop: "1px solid var(--border, #e5e7eb)", padding: "8px 0" }}>
      <Row>
        <select aria-label="Subject" value={s.subject_id} onChange={(e) => onChange({ subject_id: e.target.value, count: s.count })}>{subjects.map((x) => <option key={x.id} value={x.id}>{x.title} ({levelName(x.level)}): {x.questions} available</option>)}{!subject && <option value={s.subject_id}>Saved subject</option>}</select>
        <label>Questions <input type="number" min={1} max={200} style={{ width: 80 }} value={s.count} disabled={Boolean(mix)} onChange={(e) => onChange({ ...s, count: wholeOrNull(e.target.value) ?? 0 })} /></label>
        <label className="qb-check"><input type="checkbox" checked={Boolean(mix)} onChange={(e) => { if (!e.target.checked) return onChange({ ...s, difficulty: undefined }); const third = Math.floor(s.count / 3); onChange({ ...s, difficulty: { easy: third, medium: s.count - 2 * third, hard: third } }); }} /> Set difficulty</label>
        {mix && (["easy", "medium", "hard"] as const).map((k) => <label key={k}>{k} <input type="number" min={0} style={{ width: 70 }} value={mix[k] ?? 0} onChange={(e) => { const next = { ...mix, [k]: wholeOrNull(e.target.value) ?? 0 }; onChange({ ...s, difficulty: next, count: (next.easy ?? 0) + (next.medium ?? 0) + (next.hard ?? 0) }); }} /></label>)}
        <button type="button" className="qb-link-btn" onClick={() => setOpen(!open)}>{s.node_ids?.length ? `${s.node_ids.length} topic(s) chosen` : "Choose topics"}</button>
        <button type="button" className="qb-link-btn" onClick={onRemove}>Remove</button>
      </Row>
      {open && <div style={{ display: "grid", gap: 4, padding: "8px 0 0 16px" }}>
        <span className="qb-muted qb-small">Leave all unticked to use the whole subject.</span>
        <TopicList subject={s.subject_id} parent={null} chosen={s.node_ids ?? []} toggle={(id, on) => { const ids = on ? [...(s.node_ids ?? []), id] : (s.node_ids ?? []).filter((x) => x !== id); onChange({ ...s, node_ids: ids.length ? ids : undefined }); }} />
      </div>}
    </div>
  );
}
