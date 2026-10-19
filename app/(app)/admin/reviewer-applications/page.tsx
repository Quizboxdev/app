"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { decideApplication, listApplications, type Application, type DomainGrant } from "@/lib/api/reviewer-applications";
import { getSmeContext, type SmeContext } from "@/lib/api/sme";
import { formatDate } from "@/lib/format";

const TABS = [["pending", "Waiting"], ["verified", "Approved"], ["suspended", "Declined"]] as const;
type Pick = { subject: string; level: string; grades: string; approve: boolean; senior: boolean; on: boolean };

// Support staff and the owner vet reviewer applications here. Approve ticks the subjects the teacher may review (pre-filled from their request);
// only the owner can tick "may approve" or "senior". A decline needs a reason, which the teacher sees. Everything is enforced by the database.
export default function ReviewerApplicationsPage() {
  const [tab, setTab] = useState<"pending" | "verified" | "suspended">("pending");
  const [rows, setRows] = useState<Application[] | null>(null);
  const [open, setOpen] = useState(""), [picks, setPicks] = useState<Pick[]>([]), [note, setNote] = useState("");
  const [sme, setSme] = useState<SmeContext | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");

  const load = () => { setRows(null); listApplications(tab).then(setRows).catch((e) => { setError(e.message); setRows([]); }); };
  useEffect(load, [tab]);
  useEffect(() => { getSmeContext().then(setSme).catch(() => setSme(null)); }, []);
  const owner = !!sme?.super_admin;
  const current = useMemo(() => rows?.find((r) => r.user_id === open), [rows, open]);

  function start(a: Application) {
    setOpen(a.user_id === open ? "" : a.user_id); setNote(""); setError(""); setDone("");
    const levels = (a.requested[0]?.education_levels ?? []).join(", ");
    setPicks(a.requested.map((r) => ({ subject: r.subject_code, level: (r.education_levels ?? [])[0] ?? "", grades: "", approve: false, senior: false, on: true })).map((p) => ({ ...p, level: p.level || levels.split(",")[0]?.trim() || "" })));
  }
  async function decide(a: Application, decision: "approve" | "decline") {
    setBusy(true); setError(""); setDone("");
    try {
      const domains: DomainGrant[] = decision === "approve" ? picks.filter((p) => p.on && p.subject.trim()).map((p) => ({ subject_code: p.subject.trim(), market_id: a.requested.find((r) => r.subject_code === p.subject)?.market_id ?? null,
        education_level: p.level.trim() || null, grade_codes: p.grades.split(",").map((g) => g.trim()).filter(Boolean), can_approve: p.approve, can_senior_review: p.senior })) : [];
      const r = await decideApplication(a.user_id, decision, note.trim(), domains);
      setDone(decision === "approve" ? `${a.name} approved with ${r.domains_granted} subject${r.domains_granted === 1 ? "" : "s"}. They have been notified.` : `${a.name}'s application declined. They have been notified.`);
      setOpen(""); load();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  return (
    <>
      <div className="qb-page-head"><div><h1>Reviewer applications</h1><p>Teachers who asked to review questions. Check their details, choose the subjects they may review, then approve or decline.</p></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {done && <div className="qb-card" role="status"><CheckCircle2 size={16} aria-hidden="true" /> {done}</div>}
      <section className="qb-card"><div className="qb-chip-row" role="group" aria-label="Status">{TABS.map(([v, l]) => <button key={v} type="button" className="qb-chip" aria-pressed={tab === v} onClick={() => setTab(v)}>{l}</button>)}</div></section>

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {rows === null ? <div className="qb-card qb-skeleton" style={{ minHeight: 100 }} aria-busy="true" /> : !rows.length ? <div className="qb-card qb-muted">Nothing here.</div> :
          rows.map((a) => <article key={a.user_id} className="qb-card" aria-labelledby={`app-${a.user_id}`}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 id={`app-${a.user_id}`} style={{ margin: 0, fontSize: 17 }}>{a.name}{a.school ? ` · ${a.school}` : ""}</h2>
              <span className="qb-small qb-muted">Applied {formatDate(a.applied_at)} · {a.years_experience} years</span>
            </div>
            <div className="qb-small qb-muted"><a href={`mailto:${a.email}`}>{a.email}</a> · Wants to review: {a.requested.map((r) => `${r.subject_code}${r.education_levels?.length ? ` (${r.education_levels.join("/")})` : ""}`).join(", ") || "not stated"}</div>
            <p style={{ whiteSpace: "pre-wrap", margin: "10px 0" }}>{a.qualifications}</p>
            {a.status === "verified" && <p className="qb-small">Approved with {a.domains} subject{a.domains === 1 ? "" : "s"}{a.decision_note ? `. Note: ${a.decision_note}` : ""}.</p>}
            {a.status === "suspended" && <p className="qb-small">{a.decided_at ? `Declined ${formatDate(a.decided_at)}: ${a.decision_note ?? ""}` : "Reviewer access paused."}</p>}
            {a.status === "pending" && <button className="qb-btn" onClick={() => start(a)}>{open === a.user_id ? "Close" : "Review application"}</button>}
            {open === a.user_id && current && <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <strong>Subjects this teacher may review</strong>
              {picks.map((p, i) => <div key={i} style={{ display: "grid", gap: 8, gridTemplateColumns: "auto 1.4fr 1fr 1.2fr", alignItems: "center" }}>
                <input type="checkbox" checked={p.on} aria-label={`Grant ${p.subject}`} onChange={(e) => setPicks(picks.map((x, j) => j === i ? { ...x, on: e.target.checked } : x))} />
                <input className="qb-input" value={p.subject} aria-label="Subject" onChange={(e) => setPicks(picks.map((x, j) => j === i ? { ...x, subject: e.target.value } : x))} />
                <input className="qb-input" value={p.level} aria-label="Level" placeholder="Level" onChange={(e) => setPicks(picks.map((x, j) => j === i ? { ...x, level: e.target.value } : x))} />
                <input className="qb-input" value={p.grades} aria-label="Grades" placeholder="Grades, e.g. B7, B8" onChange={(e) => setPicks(picks.map((x, j) => j === i ? { ...x, grades: e.target.value } : x))} />
                {owner && <div style={{ gridColumn: "2 / -1", display: "flex", gap: 14, flexWrap: "wrap" }} className="qb-small">
                  <label><input type="checkbox" checked={p.approve} onChange={(e) => setPicks(picks.map((x, j) => j === i ? { ...x, approve: e.target.checked } : x))} /> May approve questions</label>
                  <label><input type="checkbox" checked={p.senior} onChange={(e) => setPicks(picks.map((x, j) => j === i ? { ...x, senior: e.target.checked } : x))} /> Senior reviewer</label></div>}
              </div>)}
              {!owner && <p className="qb-small qb-muted">Approval and senior-review rights are granted by the owner.</p>}
              <label>Note (what you checked; for a decline, the reason the teacher will see)<textarea className="qb-input" rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} style={{ width: "100%" }} /></label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="qb-btn" disabled={busy || note.trim().length < 3 || !picks.some((p) => p.on && p.subject.trim())} onClick={() => void decide(current, "approve")}><CheckCircle2 size={14} aria-hidden="true" /> Approve</button>
                <button className="qb-btn secondary" disabled={busy || note.trim().length < 10} onClick={() => void decide(current, "decline")}><XCircle size={14} aria-hidden="true" /> Decline</button>
              </div>
            </div>}
          </article>)}
      </div>
    </>
  );
}
