"use client";

import { useEffect, useState } from "react";
import { Mail, Phone } from "lucide-react";
import { enquiryCounts, listEnquiries, purgeEnquiries, reviewEnquiry, type Enquiry, type InterestStatus } from "@/lib/api/intake";
import { getSmeContext, type SmeContext } from "@/lib/api/sme";
import { formatDate } from "@/lib/format";

const CATEGORIES = [["", "All"], ["CONTACT", "General"], ["SPONSOR", "Sponsors"], ["SCHOOL", "Schools"], ["SME", "Subject experts"], ["COUNTRY", "Countries"]] as const;
const STATUSES = [["", "Any status"], ["NEW", "New"], ["IN_REVIEW", "In review"], ["CONTACTED", "Contacted"], ["CLOSED", "Closed"], ["SPAM", "Spam"]] as const;
const label = (v: string) => v.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

// Inbox for the public contact, sponsor, school, subject-expert and country forms. Support staff triage; the owner can also purge by the retention rule.
export default function InboxPage() {
  const [rows, setRows] = useState<Enquiry[] | null>(null);
  const [counts, setCounts] = useState<{ new: number; in_review: number; total: number } | null>(null);
  const [category, setCategory] = useState(""), [status, setStatus] = useState("NEW");
  const [open, setOpen] = useState(""), [note, setNote] = useState("");
  const [sme, setSme] = useState<SmeContext | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");

  const load = () => {
    setRows(null);
    Promise.all([listEnquiries({ category: category || undefined, status: status || undefined }), enquiryCounts()]).then(([r, c]) => { setRows(r); setCounts(c); }).catch((e) => { setError(e.message); setRows([]); });
  };
  useEffect(load, [category, status]);
  useEffect(() => { getSmeContext().then(setSme).catch(() => setSme(null)); }, []);

  async function act(e: Enquiry, to: Exclude<InterestStatus, "NEW">) {
    setBusy(true); setError(""); setDone("");
    try { await reviewEnquiry(e.id, to, note); setDone(`Marked ${label(to)}.`); setNote(""); setOpen(""); load(); } catch (x: any) { setError(x.message); }
    setBusy(false);
  }
  async function purge() {
    if (!window.confirm("Delete closed enquiries older than 24 months and spam older than 90 days? This cannot be undone.")) return;
    setBusy(true); setError("");
    try { const r = await purgeEnquiries(); setDone(`${r.deleted} old enquiries deleted.`); load(); } catch (x: any) { setError(x.message); }
    setBusy(false);
  }

  return (
    <>
      <div className="qb-page-head"><div><h1>Enquiry inbox</h1><p>Messages from the public forms. Reply by email, then mark what happened.</p></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {done && <div className="qb-card" role="status">{done}</div>}
      {counts && <div className="qb-grid cols-3">
        <div className="qb-card"><div className="qb-muted qb-small">New</div><strong style={{ fontSize: 26 }}>{counts.new}</strong></div>
        <div className="qb-card"><div className="qb-muted qb-small">In review</div><strong style={{ fontSize: 26 }}>{counts.in_review}</strong></div>
        <div className="qb-card"><div className="qb-muted qb-small">All time</div><strong style={{ fontSize: 26 }}>{counts.total}</strong></div>
      </div>}

      <section className="qb-card" style={{ marginTop: 16 }}>
        <div className="qb-chip-row" role="group" aria-label="Category">{CATEGORIES.map(([v, l]) => <button key={v} type="button" className="qb-chip" aria-pressed={category === v} onClick={() => setCategory(v)}>{l}</button>)}</div>
        <div className="qb-chip-row" style={{ marginTop: 8 }} role="group" aria-label="Status">{STATUSES.map(([v, l]) => <button key={v} type="button" className="qb-chip" aria-pressed={status === v} onClick={() => setStatus(v)}>{l}</button>)}</div>
      </section>

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {rows === null ? <div className="qb-card qb-skeleton" style={{ minHeight: 100 }} aria-busy="true" /> : !rows.length ? <div className="qb-card qb-muted">Nothing here.</div> :
          rows.map((e) => <article key={e.id} className="qb-card" aria-labelledby={`enq-${e.id}`}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 id={`enq-${e.id}`} style={{ margin: 0, fontSize: 17 }}>{e.name}{e.organization ? ` · ${e.organization}` : ""}</h2>
              <span><span className="qb-pill">{label(e.category)}</span> <span className={`qb-pill ${e.status === "NEW" ? "" : "success"}`}>{label(e.status)}</span></span>
            </div>
            <div className="qb-small qb-muted" style={{ marginTop: 4 }}>{formatDate(e.created_at)}{e.country_name ? ` · ${e.country_name}` : ""}{e.subject ? ` · ${e.subject}` : ""}</div>
            <p style={{ whiteSpace: "pre-wrap", margin: "10px 0" }}>{e.message}</p>
            {Object.keys(e.metadata ?? {}).length > 0 && <p className="qb-small qb-muted">{Object.entries(e.metadata).map(([k, v]) => `${label(k)}: ${v}`).join(" · ")}</p>}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <a className="qb-btn secondary" href={`mailto:${e.email}?subject=${encodeURIComponent("Your QuizBox enquiry")}`}><Mail size={14} aria-hidden="true" /> {e.email}</a>
              {e.phone && <a className="qb-btn secondary" href={`tel:${e.phone}`}><Phone size={14} aria-hidden="true" /> {e.phone}</a>}
              <button className="qb-btn" onClick={() => { setOpen(open === e.id ? "" : e.id); setNote(e.review_note ?? ""); }}>{open === e.id ? "Close" : "Update status"}</button>
            </div>
            {e.review_note && open !== e.id && <p className="qb-small qb-muted" style={{ marginTop: 8 }}>Note: {e.review_note}</p>}
            {open === e.id && <div style={{ marginTop: 10 }}>
              <label style={{ display: "block" }}>Note (optional)<textarea className="qb-input" rows={2} value={note} maxLength={1000} onChange={(x) => setNote(x.target.value)} style={{ width: "100%" }} /></label>
              <div className="qb-chip-row" style={{ marginTop: 8 }}>{(["IN_REVIEW", "CONTACTED", "CLOSED", "SPAM"] as const).map((s) => <button key={s} className="qb-btn secondary" disabled={busy} onClick={() => void act(e, s)}>{label(s)}</button>)}</div>
            </div>}
          </article>)}
      </div>

      {sme?.super_admin && <section className="qb-card" style={{ marginTop: 16 }}>
        <h2>Retention</h2>
        <p className="qb-muted">Closed enquiries are kept for 24 months and spam for 90 days. Anything still open is never deleted.</p>
        <button className="qb-btn secondary" disabled={busy} onClick={() => void purge()}>Delete expired enquiries</button>
      </section>}
    </>
  );
}
