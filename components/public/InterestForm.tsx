"use client";

import { useRef, useState, type FormEvent } from "react";
import { isIntakeAvailable, type InterestKind } from "@/lib/public/intake";
import { toSubmission, validateSubmission } from "@/lib/public/intake-validation";

export type InterestField =
  | { name: string; label: string; type: "text" | "email" | "tel" | "number"; required?: boolean; autoComplete?: string; full?: boolean }
  | { name: string; label: string; type: "textarea"; required?: boolean; full?: boolean; maxLength?: number }
  | { name: string; label: string; type: "select"; options: readonly string[]; required?: boolean; full?: boolean };

// Public expression-of-interest form. It posts to /api/public/intake (never to Supabase directly). A hidden field and a minimum time on the page
// stop simple bots; the server validates again and rate-limits. Success is shown only after the server confirms, and nothing is echoed back.
export default function InterestForm({ kind, fields, submitLabel, consentLabel }: { kind: InterestKind; fields: InterestField[]; submitLabel: string; consentLabel: string }) {
  const available = isIntakeAvailable(kind);
  const noticeId = `qbp-intake-${kind}-notice`;
  const opened = useRef(Date.now());
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === "sending") return;
    const form = e.currentTarget, data = new FormData(form);
    const values = Object.fromEntries(fields.map((f) => [f.name, String(data.get(f.name) ?? "")]));
    const payload = toSubmission(kind, values, data.get("consent") === "on");
    const checked = validateSubmission(payload);
    if (!checked.ok) { setError(checked.error); return; }
    setError(""); setState("sending");
    try {
      const res = await fetch("/api/public/intake", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...checked.value, website: String(data.get("website") ?? ""), elapsed_ms: Date.now() - opened.current }) });
      if (res.status === 202) { setState("sent"); form.reset(); return; }
      const body = await res.json().catch(() => ({}));
      setError(typeof body?.error === "string" ? body.error : "We could not send your message. Please try again.");
    } catch { setError("We could not reach the server. Check your connection and try again."); }
    setState("idle");
  }

  if (state === "sent") return (
    <div className="qbp-notice" role="status" data-qb-intake={kind} data-qb-intake-status="SENT">
      <strong>Thank you. Your message has been received.</strong>
      <span style={{ display: "block" }}>We will reply to the email address you gave. This usually takes a few working days.</span>
    </div>
  );
  return (
    <form className="qbp-form qb-form" data-qb-intake={kind} data-qb-intake-status={available ? "OPEN" : "COMING_SOON"} aria-describedby={available ? undefined : noticeId} onSubmit={onSubmit} noValidate={false}>
      {!available && (
        <div id={noticeId} className="qbp-notice" role="note">
          <strong>Expression of interest form coming soon</strong>
          <span style={{ display: "block" }}>Online submissions are not open yet. The details we will ask for are shown below.</span>
        </div>
      )}
      <fieldset disabled={!available || state === "sending"} className="qbp-fieldset">
        <legend className="qbp-sr-only">Your details</legend>
        <div className="qbp-form-grid">
          {fields.map((field) => {
            const fieldId = `qbp-${kind}-${field.name}`;
            const label = `${field.label}${field.required ? "" : " (optional)"}`;
            return (
              <div key={field.name} className="qb-field" style={field.full || field.type === "textarea" ? { gridColumn: "1 / -1" } : undefined}>
                <label htmlFor={fieldId}>{label}</label>
                {field.type === "textarea" ? (
                  <textarea id={fieldId} name={field.name} required={field.required} maxLength={field.maxLength ?? 1500} />
                ) : field.type === "select" ? (
                  <select id={fieldId} name={field.name} required={field.required} defaultValue="">
                    <option value="" disabled>Select…</option>
                    {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : (
                  <input id={fieldId} name={field.name} type={field.type} required={field.required} autoComplete={field.autoComplete} maxLength={200} min={field.type === "number" ? 0 : undefined} />
                )}
              </div>
            );
          })}
        </div>
        {/* Honeypot: invisible to people and to screen readers; a bot that fills it is silently dropped. */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
          <label>Leave this empty<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
        </div>
        <label className="qbp-check" style={{ marginTop: 14 }}><input type="checkbox" name="consent" required />{consentLabel}</label>
        {error && <p role="alert" className="qb-error" style={{ marginTop: 10 }}>{error}</p>}
        <div className="qbp-actions" style={{ marginTop: 14 }}>
          <button type="submit" className="qbp-btn" disabled={!available || state === "sending"}>{!available ? "Coming soon" : state === "sending" ? "Sending…" : submitLabel}</button>
        </div>
      </fieldset>
    </form>
  );
}
