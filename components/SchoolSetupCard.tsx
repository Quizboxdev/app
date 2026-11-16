"use client";

import { useEffect, useRef, useState } from "react";
import { getMyAccount } from "@/lib/api/markets";
import {
  LEVEL_LABEL, OWNERSHIP_LABEL, listSchoolDistricts, listSchoolRegions, searchSchools, setMySchool, submitSchool,
  type DistrictCount, type Ownership, type RegionCount, type SchoolLevel, type SchoolPick,
} from "@/lib/api/schools";

// "Set up your school" for students and teachers. Region first, then district, then the school's name, so schools with similar names never get mixed up.
// Public / Private and the level narrow the list. If the school is missing the person adds it (staff approve it later) and it is linked straight away.
// The card shows nothing until the school directory is switched on, and nothing once a school is set.
type Step = "hidden" | "pick" | "add" | "done";
const LEVELS: SchoolLevel[] = ["primary", "jhs", "shs"];

export default function SchoolSetupCard({ defaultLevel }: { defaultLevel?: SchoolLevel }) {
  const [step, setStep] = useState<Step>("hidden");
  const [regions, setRegions] = useState<RegionCount[]>([]), [districts, setDistricts] = useState<DistrictCount[]>([]), [schools, setSchools] = useState<SchoolPick[] | null>(null);
  const [region, setRegion] = useState(""), [district, setDistrict] = useState(""), [query, setQuery] = useState("");
  const [ownership, setOwnership] = useState<Ownership | "">(""), [level, setLevel] = useState<SchoolLevel | "">(defaultLevel ?? "");
  const [name, setName] = useState(""), [newLevels, setNewLevels] = useState<SchoolLevel[]>(defaultLevel ? [defaultLevel] : []), [newOwnership, setNewOwnership] = useState<Ownership | "">("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let live = true;
    getMyAccount().then(async (a) => {
      if (!live || a.school_name) return;
      try { const r = await listSchoolRegions(); if (live && r.length) { setRegions(r); setStep("pick"); } } catch { /* directory not open yet: stay hidden */ }
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (step !== "pick" && step !== "add") return;
    let live = true;
    listSchoolRegions({ ownership, level }).then((r) => { if (live) setRegions(r); }).catch(() => undefined);
    return () => { live = false; };
  }, [step, ownership, level]);

  useEffect(() => {
    setDistrict(""); setDistricts([]); setSchools(null);
    if (!region) return;
    let live = true;
    listSchoolDistricts(region, { ownership, level }).then((d) => { if (live) setDistricts(d); }).catch(() => undefined);
    return () => { live = false; };
  }, [region, ownership, level]);

  useEffect(() => {
    if (!region || (!district && query.trim().length < 3)) { setSchools(null); return; }
    let live = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      searchSchools({ region, district, query, ownership, level }).then((s) => { if (live) { setSchools(s); setError(""); } }).catch((e: Error) => { if (live) setError(e.message); });
    }, 250);
    return () => { live = false; if (timer.current) clearTimeout(timer.current); };
  }, [region, district, query, ownership, level]);

  async function choose(id: string) {
    setBusy(true); setError("");
    try { const r = await setMySchool(id); setSaved(r.name); setStep("done"); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  async function addMine() {
    setBusy(true); setError("");
    try { const s = await submitSchool({ region, district, name, ownership: newOwnership, levels: newLevels }); const r = await setMySchool(s.id); setSaved(r.name); setStep("done"); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  if (step === "hidden") return null;
  if (step === "done") return <section className="qb-card" role="status" aria-live="polite"><h2 style={{ margin: 0 }}>Your school is set</h2><p className="qb-muted" style={{ margin: "4px 0 0" }}>{saved}</p></section>;

  const chip = (on: boolean) => `qb-chip${on ? " is-on" : ""}`;
  return (
    <section className="qb-card" aria-labelledby="school-setup-title" style={{ display: "grid", gap: 12 }}>
      <div>
        <h2 id="school-setup-title" style={{ margin: 0 }}>Set up your school</h2>
        <p className="qb-muted" style={{ margin: "4px 0 0" }}>Choose your region, then your district, then your school. It takes about 20 seconds and lets your teachers and classmates find you.</p>
      </div>
      <div className="qb-chip-row" role="group" aria-label="Type of school">
        {([["", "All schools"], ["public", OWNERSHIP_LABEL.public], ["private", OWNERSHIP_LABEL.private]] as const).map(([v, l]) => <button key={v || "all"} type="button" className={chip(ownership === v)} aria-pressed={ownership === v} onClick={() => setOwnership(v as Ownership | "")}>{l}</button>)}
        <span aria-hidden="true" style={{ width: 8 }} />
        {([["", "Any level"], ...LEVELS.map((l) => [l, LEVEL_LABEL[l]] as const)] as const).map(([v, l]) => <button key={v || "any"} type="button" className={chip(level === v)} aria-pressed={level === v} onClick={() => setLevel(v as SchoolLevel | "")}>{l}</button>)}
      </div>
      <div className="qb-grid cols-2">
        <label className="qb-field">Region
          <select value={region} onChange={(e) => setRegion(e.target.value)}><option value="">Choose your region</option>{regions.map((r) => <option key={r.region} value={r.region}>{r.region} ({r.schools})</option>)}</select></label>
        <label className="qb-field">District
          <select value={district} disabled={!region} onChange={(e) => setDistrict(e.target.value)}><option value="">{region ? "Choose your district" : "Choose a region first"}</option>{districts.map((d) => <option key={d.district} value={d.district}>{d.district} ({d.schools})</option>)}</select></label>
      </div>
      {step === "pick" && <>
        <label className="qb-field">School name
          <input value={query} disabled={!region} onChange={(e) => setQuery(e.target.value)} placeholder={region ? "Type to find your school" : "Choose a region first"} autoComplete="off" /></label>
        {error && <p className="qb-error" role="alert" style={{ margin: 0 }}>{error}</p>}
        {schools && (schools.length === 0
          ? <p className="qb-muted" style={{ margin: 0 }}>No school matches yet. Try fewer letters, or add your school below.</p>
          : <ul role="listbox" aria-label="Schools" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6, maxHeight: 280, overflow: "auto" }}>
            {schools.map((s) => <li key={s.id}><button type="button" role="option" aria-selected="false" className="qb-btn secondary" style={{ width: "100%", justifyContent: "space-between", textAlign: "start" }} disabled={busy} onClick={() => void choose(s.id)}>
              <span>{s.name}<span className="qb-muted" style={{ display: "block", fontSize: 12, fontWeight: 400 }}>{[s.town, s.district].filter(Boolean).join(" · ")}</span></span>
              <span className="qb-muted" style={{ fontSize: 12 }}>{[s.ownership ? OWNERSHIP_LABEL[s.ownership] : "", s.levels.map((l) => LEVEL_LABEL[l]).join(" / ")].filter(Boolean).join(" · ")}</span></button></li>)}
          </ul>)}
        <button type="button" className="qb-btn secondary" style={{ justifySelf: "start" }} disabled={!region || !district} onClick={() => { setName(query); setStep("add"); }}>My school is not listed</button>
      </>}
      {step === "add" && <>
        <label className="qb-field">Your school&apos;s full name
          <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bright Future Academy" /></label>
        <div className="qb-chip-row" role="group" aria-label="Levels your school teaches">
          {LEVELS.map((l) => <button key={l} type="button" className={chip(newLevels.includes(l))} aria-pressed={newLevels.includes(l)} onClick={() => setNewLevels(newLevels.includes(l) ? newLevels.filter((x) => x !== l) : [...newLevels, l])}>{LEVEL_LABEL[l]}</button>)}
          <span aria-hidden="true" style={{ width: 8 }} />
          {(["public", "private"] as const).map((o) => <button key={o} type="button" className={chip(newOwnership === o)} aria-pressed={newOwnership === o} onClick={() => setNewOwnership(newOwnership === o ? "" : o)}>{OWNERSHIP_LABEL[o]}</button>)}
        </div>
        {error && <p className="qb-error" role="alert" style={{ margin: 0 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="qb-btn" disabled={busy || name.trim().length < 3 || !newLevels.length || !district} onClick={() => void addMine()}>{busy ? "Saving…" : "Add my school"}</button>
          <button type="button" className="qb-btn secondary" disabled={busy} onClick={() => setStep("pick")}>Back to the list</button>
        </div>
        <p className="qb-muted" style={{ margin: 0, fontSize: 12 }}>Our team checks new schools so every name is spelt the same way for everyone.</p>
      </>}
    </section>
  );
}
