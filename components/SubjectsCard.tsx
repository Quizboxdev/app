"use client";

import { useEffect, useMemo, useState } from "react";
import { getMyAccount, listSignupCountries, setMySubjects, type ConfigOption } from "@/lib/api/markets";
import { userFacingError } from "@/lib/errors";

// "Your subjects" in the student workspace. Sign-up no longer asks for subjects: after choosing a class level the learner lands here and ticks the subjects their school teaches.
// The list is the market's subjects for the learner's level. Nothing shows for teachers or accounts managed by an adult.
export default function SubjectsCard() {
  const [options, setOptions] = useState<ConfigOption[] | null>(null), [saved, setSaved] = useState<string[]>([]), [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const a = await getMyAccount();
      if (!live || !a.student) return;
      const countries = await listSignupCountries();
      const c = countries.find((x) => x.market_id && x.market_id === a.primary_market?.id) ?? countries.find((x) => x.country === a.country || x.country_code === a.country);
      const level = a.student.education_level;
      const list = (c?.subjects ?? []).filter((s) => !s.level || !level || s.level === level);
      if (!live || !list.length) return;
      setOptions(list); setSaved(a.student.subjects ?? []); setPicked(a.student.subjects ?? []); setOpen((a.student.subjects ?? []).length === 0);
    })().catch(() => undefined);
    return () => { live = false; };
  }, []);

  const changed = useMemo(() => picked.length !== saved.length || picked.some((p) => !saved.includes(p)), [picked, saved]);
  if (!options) return null;
  const label = (code: string) => options.find((o) => o.code === code)?.label ?? code;
  const toggle = (code: string) => setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));
  async function save() {
    setBusy(true); setError(""); setNote("");
    try { const r = await setMySubjects(picked); setSaved(r); setPicked(r); setOpen(false); setNote(r.length ? "Saved. Your subjects are on your profile." : "Saved."); }
    catch (cause) { setError(userFacingError(cause)); }
    setBusy(false);
  }

  return (
    <section className="qb-card" aria-labelledby="subjects-title" style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "start" }}>
        <div>
          <h2 id="subjects-title" style={{ margin: 0 }}>{saved.length ? "Your subjects" : "Add your subjects"}</h2>
          <p className="qb-muted" style={{ margin: "4px 0 0" }}>{open ? "Tick the subjects your school teaches. You can change them any time." : saved.length ? saved.map(label).join(" · ") : "Pick the subjects your school teaches so practice matches your class."}</p>
        </div>
        {!open && <button type="button" className="qb-btn secondary" onClick={() => { setPicked(saved); setOpen(true); setNote(""); }}>{saved.length ? "Change" : "Add subjects"}</button>}
      </div>
      {open && <>
        <div className="qb-chip-row" role="group" aria-label="Subjects">
          {options.map((o) => <button key={o.code} type="button" className="qb-chip" aria-pressed={picked.includes(o.code)} onClick={() => toggle(o.code)}>{o.label}</button>)}
        </div>
        {error && <p className="qb-error" role="alert" style={{ margin: 0 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="qb-btn" disabled={busy || !changed} onClick={() => void save()}>{busy ? "Saving…" : "Save my subjects"}</button>
          {saved.length > 0 && <button type="button" className="qb-btn secondary" disabled={busy} onClick={() => { setOpen(false); setPicked(saved); setError(""); }}>Cancel</button>}
        </div>
      </>}
      {note && <p role="status" className="qb-success" style={{ margin: 0 }}>{note}</p>}
    </section>
  );
}
