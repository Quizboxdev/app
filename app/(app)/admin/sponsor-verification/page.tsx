"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { decideSponsor, sponsorQueue, type SponsorToVerify, type VerificationFilter } from "@/lib/api/sponsor-verification";
import { formatDate } from "@/lib/format";
import { verificationView } from "@/lib/sponsor/verification";

const TABS: ReadonlyArray<readonly [VerificationFilter, string]> = [["PENDING", "Waiting"], ["VERIFIED", "Verified"], ["REJECTED", "Not verified"], ["ALL", "All"]];

// A super administrator checks who is behind each sponsor and verifies or declines. A decline needs a reason, which the sponsor reads on their dashboard.
// Check an organisation against a record outside QuizBox (registration, website, a person you can call) before you verify. Verification is shown to the sponsor; it does not unlock or lock anything yet.
export default function SponsorVerificationPage() {
  const [tab, setTab] = useState<VerificationFilter>("PENDING");
  const [rows, setRows] = useState<SponsorToVerify[] | null>(null);
  const [open, setOpen] = useState(""), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");

  const load = useCallback((t: VerificationFilter) => { setRows(null); sponsorQueue(t).then(setRows).catch((e) => { setError(e.message); setRows([]); }); }, []);
  useEffect(() => { load(tab); }, [tab, load]);

  async function decide(r: SponsorToVerify, decision: "VERIFIED" | "REJECTED" | "PENDING") {
    if (decision === "REJECTED" && note.trim().length < 10) { setError("Write the reason (at least 10 characters). The sponsor will read it."); return; }
    setBusy(true); setError(""); setDone("");
    try {
      await decideSponsor(r.id, decision, note);
      setDone(`${r.organization_name ?? "Sponsor"}: ${decision === "VERIFIED" ? "verified" : decision === "REJECTED" ? "not verified" : "put back to waiting"}.`);
      setOpen(""); setNote(""); load(tab);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  return (
    <div className="dx-page">
      <div className="dx-head"><div><h1>Sponsor verification</h1>
        <p>Check who is behind each sponsor before their name sits next to work for children. Verify only what you could confirm outside QuizBox: a registration, a website, a person you can call.</p></div></div>
      {error && <div className="dx-alert error" role="alert">{error}</div>}
      {done && <div className="qb-card" role="status"><CheckCircle2 size={16} aria-hidden="true" /> {done}</div>}
      <section className="qb-card">
        <div role="tablist" aria-label="Sponsor lists" style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {TABS.map(([t, l]) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "qb-btn" : "qb-btn secondary"} onClick={() => { setTab(t); setOpen(""); }}>{l}</button>)}
        </div>
        {rows === null ? <p className="qb-muted">Loading…</p> : !rows.length ? <p className="qb-muted">{tab === "PENDING" ? "No sponsor is waiting for verification." : "Nothing here."}</p> :
          <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Organisation</th><th>Contact</th><th>Status</th><th>Action</th></tr></thead><tbody>
            {rows.map((r) => { const v = verificationView(r.verification_status, r.verification_note); return <tr key={r.id}>
              <td>{r.organization_name ?? "(no name)"}<div className="qb-small qb-muted">{[r.sponsor_type, r.country].filter(Boolean).join(" · ")}{r.website ? ` · ${r.website}` : ""}</div><div className="qb-small qb-muted">Joined {formatDate(r.created_at)}</div></td>
              <td>{r.contact_name ?? "-"}<div className="qb-small qb-muted">{r.email ?? ""}</div></td>
              <td><span className={`qb-pill${v.tone === "ok" ? " success" : ""}`}>{v.label}</span>{r.verification_note && <div className="qb-small qb-muted">{r.verification_note}</div>}</td>
              <td>{open === r.id ? <div style={{ display: "grid", gap: 8, minWidth: 240 }}>
                <textarea className="qb-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (needed to decline; the sponsor reads it)" aria-label="Reason" />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="qb-btn" disabled={busy} onClick={() => void decide(r, "VERIFIED")}><CheckCircle2 size={14} aria-hidden="true" /> Verify</button>
                  <button className="qb-btn secondary" disabled={busy} onClick={() => void decide(r, "REJECTED")}><XCircle size={14} aria-hidden="true" /> Decline</button>
                  <button className="qb-btn ghost" disabled={busy} onClick={() => { setOpen(""); setNote(""); }}>Cancel</button></div></div>
                : <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="qb-btn" disabled={busy} onClick={() => { setOpen(r.id); setNote(""); setError(""); }}>Decide</button>
                  {r.verification_status !== "PENDING" && <button className="qb-btn ghost" disabled={busy} onClick={() => void decide(r, "PENDING")}>Back to waiting</button>}</div>}</td></tr>; })}
          </tbody></table></div>}
      </section>
    </div>
  );
}
