"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { reportChallenge, type ReportReason } from "@/lib/api/challenges";

const REASONS: [ReportReason, string][] = [["inappropriate", "Inappropriate or harmful"], ["misleading", "Misleading or a scam"], ["copyright", "Uses someone else's work without permission"], ["wrong_answers", "Questions or answers are wrong"], ["spam", "Spam"], ["other", "Something else"]];

// A small "Report this challenge" control for the public page. Reporting needs a signed-in account (to stop abuse); three different reporters hide a challenge until an administrator reviews it.
export default function ReportChallenge({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState<ReportReason>("inappropriate"), [details, setDetails] = useState(""), [state, setState] = useState<"idle" | "busy" | "done" | "signin" | "error">("idle"), [message, setMessage] = useState("");

  async function start() {
    try { const { data } = await getSupabaseBrowserClient().auth.getSession(); if (!data.session) { setState("signin"); return; } } catch { setState("signin"); return; }
    setOpen(true);
  }
  async function send(e: React.FormEvent) {
    e.preventDefault(); setState("busy"); setMessage("");
    try { await reportChallenge(slug, reason, details.trim()); setState("done"); setOpen(false); } catch (err: any) { setState("error"); setMessage(err.message); }
  }
  if (state === "done") return <p className="qbp-meta" role="status">Thank you. Your report has been sent to the QuizBox team.</p>;
  if (state === "signin") return <p className="qbp-meta">Please <a className="qbp-link" href={`/login?next=${encodeURIComponent(`/challenges/${slug}`)}`}>sign in</a> to report a challenge.</p>;
  return (
    <div>
      {!open && <button type="button" className="qbp-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={start}>Report this challenge</button>}
      {open && (
        <form onSubmit={send} className="qbp-form" aria-label="Report this challenge" style={{ display: "grid", gap: 8, maxWidth: 520 }}>
          <label>Reason<select value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label>Details (optional)<textarea maxLength={500} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} /></label>
          {state === "error" && <p role="alert">{message}</p>}
          <div style={{ display: "flex", gap: 8 }}><button className="qbp-btn" disabled={state === "busy"}>{state === "busy" ? "Sending…" : "Send report"}</button><button type="button" className="qbp-btn2" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      )}
    </div>
  );
}
