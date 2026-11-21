"use client";

import { FormEvent, useEffect, useState } from "react";
import { adminDecideSchool, LEVEL_LABEL, listSchoolDistricts, submitSchool, type Ownership, type SchoolLevel } from "@/lib/api/schools";
import { Panel } from "@/components/admin/DataViz";

const LEVELS: SchoolLevel[] = ["primary", "jhs", "shs"];

// Add one school without a file. It goes in through the same checks as a school a user adds (name rules, look-alike and duplicate check), then a super administrator's approval makes it live at once.
export default function AddSchoolPanel({ regions, onAdded }: { regions: string[]; onAdded: () => void }) {
  const [region, setRegion] = useState(""), [district, setDistrict] = useState(""), [name, setName] = useState(""), [town, setTown] = useState("");
  const [ownership, setOwnership] = useState<Ownership | "">(""), [levels, setLevels] = useState<SchoolLevel[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");
  const [districts, setDistricts] = useState<string[]>([]);
  useEffect(() => { if (!region) { setDistricts([]); return; } let live = true; listSchoolDistricts(region).then((d) => { if (live) setDistricts(d.map((x) => x.district)); }).catch(() => { if (live) setDistricts([]); }); return () => { live = false; }; }, [region]);
  const ready = region && district.trim().length >= 2 && name.trim().length >= 3 && levels.length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault(); if (!ready || busy) return; setBusy(true); setError(""); setDone("");
    try {
      const r = await submitSchool({ region, district: district.trim(), name: name.trim(), ownership, levels, town: town.trim() || undefined });
      if (r.existing) setDone(`${r.name} is already in the directory (${r.status === "pending" ? "waiting for review: find it under Waiting" : "listed"}). Nothing was added.`);
      else { await adminDecideSchool(r.id, "approve", "Added by a super administrator"); setDone(`${r.name} was added and approved. Students and teachers can pick it now.`); setName(""); setTown(""); setLevels([]); onAdded(); }
    } catch (cause) { setError((cause as Error).message); }
    setBusy(false);
  }
  const toggle = (l: SchoolLevel) => setLevels((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));

  return (
    <Panel title="Add one school" subtitle="For a school that is not in the list. Look-alikes and duplicates are checked for you.">
      <form onSubmit={submit} style={{ display: "grid", gap: 12, maxWidth: 560 }}>
        {error && <div className="dx-alert error" role="alert">{error}</div>}
        {done && <div className="dx-alert ok" role="status">{done}</div>}
        <label className="qb-field">Region
          <select className="dx-select" value={region} onChange={(e) => { setRegion(e.target.value); setDistrict(""); }} required><option value="">Choose a region</option>{regions.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
        <label className="qb-field">District
          <input className="dx-input" list="add-school-districts" value={district} onChange={(e) => setDistrict(e.target.value)} maxLength={100} required placeholder="Start typing the district" />
          <datalist id="add-school-districts">{districts.map((d) => <option key={d} value={d} />)}</datalist></label>
        <label className="qb-field">School name<input className="dx-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required /></label>
        <label className="qb-field">Town (optional)<input className="dx-input" value={town} onChange={(e) => setTown(e.target.value)} maxLength={100} /></label>
        <label className="qb-field">Public or private
          <select className="dx-select" value={ownership} onChange={(e) => setOwnership(e.target.value as Ownership | "")}><option value="">Not set</option><option value="public">Public</option><option value="private">Private</option></select></label>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="qb-small">Levels the school offers</legend>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{LEVELS.map((l) => <label key={l} className="qb-check" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={levels.includes(l)} onChange={() => toggle(l)} /> {LEVEL_LABEL[l]}</label>)}</div></fieldset>
        <div><button className="dx-btn primary" type="submit" disabled={!ready || busy}>{busy ? "Adding…" : "Add and approve"}</button></div>
      </form>
    </Panel>
  );
}
