"use client";
import { FormEvent, useState } from "react";
import { reportQuestion } from "@/lib/api/platform";

// Learner dispute: enters the content quality-review queue; it never changes the question or the score.
export default function ReportQuestion({ questionId }: { questionId: string }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState(""), [state, setState] = useState<"idle" | "busy" | "done">("idle"), [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setState("busy"); setError("");
    try { await reportQuestion(questionId, reason); setState("done"); } catch (cause) { setError((cause as Error).message); setState("idle"); }
  }
  if (state === "done") return <p className="qb-small qb-muted" role="status">Thanks. A reviewer will check this question.</p>;
  if (!open) return <button type="button" className="qb-btn ghost qb-small" onClick={() => setOpen(true)} style={{ float: "right" }}>Report a problem</button>;
  return <form className="qb-content-filters" onSubmit={submit}><label>What is wrong?<input value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={500} required/></label>
    <button className="qb-btn secondary" disabled={state === "busy"}>Send</button><button type="button" className="qb-btn ghost" onClick={() => setOpen(false)}>Cancel</button>{error && <span className="qb-error" role="alert">{error}</span>}</form>;
}
