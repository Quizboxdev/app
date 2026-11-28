"use client";

import { useEffect, useState } from "react";
import { updateCompetition } from "@/lib/api/interschool";
import { Notice, Row, useAction } from "../ui";
import { PUBLISHED_EDITABLE, changes, fromInput, toInput, wholeOrNull } from "@/lib/interschool/wizard";
import { SCORING, TIE_BREAK } from "@/lib/interschool/text";
import type { Managed, Settings } from "@/lib/interschool/types";

export default function DetailsTab({ c, reload }: { c: Managed; reload: () => Promise<unknown> }) {
  const [form, setForm] = useState<Settings>(c);
  useEffect(() => setForm(c), [c]);
  const act = useAction(reload);
  const draft = c.status === "DRAFT" || c.status === "PENDING_APPROVAL", locked = c.status === "COMPLETED" || c.status === "CANCELLED";
  const off = (k: keyof Settings) => locked || (!draft && !PUBLISHED_EDITABLE.includes(k));
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: keyof Settings, label: string, max = 140, hint?: string) => <label className="qb-field">{label}<input value={(form[k] as string | null) ?? ""} maxLength={max} disabled={off(k)} onChange={(e) => set(k, e.target.value as never)} />{hint && <span className="qb-muted qb-small">{hint}</span>}</label>;
  const area = (k: "description" | "rules" | "prizes", label: string, max: number) => <label className="qb-field">{label}<textarea rows={4} value={form[k]} maxLength={max} disabled={off(k)} onChange={(e) => set(k, e.target.value)} /></label>;
  const num = (k: keyof Settings, label: string, optional = false) => <label className="qb-field">{label}<input type="number" min={optional ? 0 : 1} value={(form[k] as number | null) ?? ""} disabled={off(k)} onChange={(e) => set(k, (optional ? wholeOrNull(e.target.value) || null : wholeOrNull(e.target.value) ?? 0) as never)} /></label>;
  const date = (k: "registration_opens_at" | "registration_closes_at" | "opens_at" | "ends_at", label: string) => <label className="qb-field">{label} (GMT)<input type="datetime-local" value={toInput(form[k])} disabled={off(k)} onChange={(e) => set(k, fromInput(e.target.value))} /></label>;
  const pick = <K extends "scale" | "participation" | "entry_mode" | "registration_mode" | "funding" | "school_scoring" | "score_carry">(k: K, label: string, options: Array<[Settings[K], string]>) =>
    <label className="qb-field">{label}<select value={form[k]} disabled={off(k)} onChange={(e) => set(k, e.target.value as Settings[K])}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
  const grid = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" } as const;
  const patch = changes(c, form);
  return (
    <form onSubmit={(e) => { e.preventDefault(); void act.run(() => updateCompetition(c.id, patch), "Saved."); }}>
      <Notice error={act.error} done={act.done} />
      {!draft && !locked && <div className="qb-card" role="status">Published: rules, levels and scoring are frozen. Presentation, capacity and later closing dates can still change.</div>}
      <div className="qb-card"><h2>About</h2>{text("title", "Title")}{area("description", "Description", 4000)}
        <div style={grid}>{text("sponsor_name", "Sponsor's name")}{text("sponsor_logo_url", "Sponsor logo address", 500, "An https link to the image")}{text("flyer_url", "Your own flyer address", 500, "Optional: a flyer is also made for you")}</div></div>
      <div className="qb-card"><h2>Who takes part</h2><div style={grid}>
        {pick("participation", "Participation", [["INVITE", "Invited schools only"], ["OPEN", "Open to verified schools"]])}
        {pick("entry_mode", "Entry", [["SCHOOL_TEAM", "School teams"], ["INDIVIDUAL", "Individual learners"]])}
        {pick("registration_mode", "Who registers learners", [["BOTH", "Learners or teachers"], ["TEACHER", "Teachers only"], ["LEARNER", "Learners only"]])}
        {pick("funding", "Funding", [["FREE", "Free"], ["SPONSORED", "Sponsored (paid per participant)"], ...(c.is_admin || c.funding === "COMPLIMENTARY" ? [["COMPLIMENTARY", "Complimentary"] as [Settings["funding"], string]] : [])])}
        {pick("scale", "Scale", [["SCHOOLS", "A few schools"], ["DISTRICT", "District"], ["REGIONAL", "Regional"], ["NATIONAL", "National"]])}
        {text("region", "Region", 80)}{text("district", "District", 80)}</div></div>
      <div className="qb-card"><h2>Capacity</h2><div style={grid}>{num("expected_participants", "Expected participants")}{num("capacity", "Registration capacity")}{num("max_schools", "Most schools", true)}{num("max_per_school", "Most learners per school", true)}{num("max_per_level_per_school", "Most per class level per school", true)}</div>
        <label className="qb-check"><input type="checkbox" checked={form.waitlist} disabled={off("waitlist")} onChange={(e) => set("waitlist", e.target.checked)} /> Keep a waiting list when full</label></div>
      <div className="qb-card"><h2>Dates</h2><div style={grid}>{date("registration_opens_at", "Registration opens")}{date("registration_closes_at", "Registration closes")}{date("opens_at", "Competition opens")}{date("ends_at", "Competition ends")}</div></div>
      <div className="qb-card"><h2>Scoring</h2><div style={grid}>
        {pick("school_scoring", "School ranking", (Object.entries(SCORING) as Array<[Settings["school_scoring"], string]>))}
        {num("scoring_top_n", "Best learners counted")}{num("min_candidates", "Fewest learners for a school to be ranked")}
        {pick("score_carry", "Scores between rounds", [["RESET", "Start again each round"], ["ACCUMULATE", "Add up across rounds"]])}</div>
        <p className="qb-muted qb-small">{TIE_BREAK} Absent learners score zero. Disqualified learners are removed from results.</p>
        {area("rules", "Rules", 6000)}{area("prizes", "Prizes", 2000)}</div>
      {!locked && <Row><button className="qb-btn" disabled={act.busy || Object.keys(patch).length === 0}>{draft ? "Save draft" : "Save changes"}</button>{Object.keys(patch).length > 0 && <span className="qb-muted">Unsaved changes</span>}</Row>}
    </form>
  );
}
