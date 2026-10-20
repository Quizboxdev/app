"use client";

import { useEffect, useState } from "react";
import { myAudiences, setAudience } from "@/lib/api/challenges";
import { FORMATS, formatOf } from "@/lib/challenges/types";

// Who can join. Everyone (or anyone with the link or code) is set when the campaign is made. A teacher can also aim it at one of their classes, and a school
// administrator at a whole school: it is then open only to those people, is never listed publicly, and they are told when it goes live.
export default function AudiencePanel({ id, draft, format, current, onChanged, onError }: { id: string; draft: boolean; format?: string; current: { class?: string | null; institution?: string | null }; onChanged: () => void; onError: (m: string) => void }) {
  const noun = FORMATS[formatOf(format)].noun;
  const [options, setOptions] = useState<Awaited<ReturnType<typeof myAudiences>> | null>(null), [value, setValue] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { myAudiences().then(setOptions).catch(() => setOptions({ classes: [], institutions: [] })); }, []);
  useEffect(() => { setValue(current.class ? `c:${current.class}` : current.institution ? `i:${current.institution}` : ""); }, [current.class, current.institution]);
  if (!options || (options.classes.length === 0 && options.institutions.length === 0)) return null;
  async function save() {
    setBusy(true); onError("");
    try { await setAudience(id, { classId: value.startsWith("c:") ? value.slice(2) : null, institutionId: value.startsWith("i:") ? value.slice(2) : null }); onChanged(); } catch (e: any) { onError(e.message); }
    setBusy(false);
  }
  return (
    <div className="qb-card qb-form">
      <h2>Aim this {noun} at a class or school</h2>
      <p className="qb-muted">Leave on &ldquo;Open to whoever has the link or code&rdquo; to invite anyone. Choose a class or school to keep it to those learners and teachers; they get a notification when you publish.</p>
      <label className="qb-field">Audience<select disabled={!draft} value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">Open to whoever has the link or code</option>
        {options.classes.map((c) => <option key={c.id} value={`c:${c.id}`}>Class: {c.name}</option>)}
        {options.institutions.map((i) => <option key={i.id} value={`i:${i.id}`}>Whole school: {i.name}</option>)}
      </select></label>
      {draft ? <div><button type="button" className="qb-btn" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save audience"}</button></div> : <p className="qb-muted">The audience is locked once the {noun} has gone live.</p>}
    </div>
  );
}
