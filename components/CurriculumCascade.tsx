"use client";

import { useMemo, useState } from "react";
import { cascadeOptions, type Catalogue } from "@/lib/sme/catalogue";

// Cascading dropdowns from the curriculum pool: market, then education level, then grades (tick one or more), then subject.
// Submits through the same field names the configuration form already uses (market_id, education_level, grade_codes, subject_code),
// so nothing has to be typed. An existing value that is no longer in the pool is kept as an option rather than silently dropped.
export default function CurriculumCascade({ catalogue, initial, disabled, subjectRequired = true }: {
  catalogue: Catalogue; disabled?: boolean; subjectRequired?: boolean;
  initial: { market?: string | null; level?: string | null; grades?: string[] | null; subject?: string | null };
}) {
  const [market, setMarket] = useState(initial.market ?? ""), [level, setLevel] = useState(initial.level ?? "");
  const [grades, setGrades] = useState<string[]>(initial.grades ?? []), [subject, setSubject] = useState(initial.subject ?? "");
  const options = useMemo(() => cascadeOptions(catalogue, { market, level, grades }), [catalogue, market, level, grades]);
  const withCurrent = (list: string[], current: string) => (current && !list.includes(current) ? [current, ...list] : list);
  return <fieldset className="qb-cascade" disabled={disabled}>
    <legend>Where this applies</legend>
    <label>Market<select name="market_id" value={market} onChange={(e) => { setMarket(e.target.value); setLevel(""); setGrades([]); setSubject(""); }}>
      <option value="">All markets</option>{catalogue.markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
    <label>Level<select name="education_level" value={level} onChange={(e) => { setLevel(e.target.value); setGrades([]); setSubject(""); }}>
      <option value="">All levels</option>{withCurrent(options.levels, level).map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
    <div role="group" aria-label="Grades"><span>Grades {grades.length === 0 && <em className="qb-muted">(none ticked = every grade)</em>}</span>
      {options.grades.length === 0 && <span className="qb-muted"> choose a level first</span>}
      {options.grades.map((g) => <label key={g} className="qb-small"><input type="checkbox" checked={grades.includes(g)}
        onChange={(e) => { setGrades(e.target.checked ? [...grades, g] : grades.filter((x) => x !== g)); setSubject(""); }}/> {g}</label>)}
      <input type="hidden" name="grade_codes" value={grades.join(",")}/></div>
    <label>Subject<select name="subject_code" value={subject} required={subjectRequired} onChange={(e) => setSubject(e.target.value)}>
      <option value="">Select a subject</option>{withCurrent(options.subjects, subject).map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
  </fieldset>;
}
