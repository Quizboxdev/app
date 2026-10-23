"use client";

import { useRef, useState, type FormEvent } from "react";
import { AttachPicker } from "@/components/support/parts";

// The public contact form: a message and up to 3 files (screenshots or a PDF). It posts to /api/support/contact (never to Supabase). A hidden field and a minimum time on the page stop simple bots;
// the server checks everything again, including what is inside each file. On success the person gets a reference to quote. Nothing they typed is echoed back.
export const CONTACT_TYPES = ["General enquiry", "Account support", "Payment or refund"] as const;

export default function SupportContactForm({ initialType }: { initialType?: string }) {
  const opened = useRef(Date.now());
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle"), [error, setError] = useState(""), [files, setFiles] = useState<File[]>([]), [reference, setReference] = useState(""), [filesFailed, setFilesFailed] = useState(false);
  const [type, setType] = useState<string>(CONTACT_TYPES.includes(initialType as never) ? (initialType as string) : "");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === "sending") return;
    const form = e.currentTarget, data = new FormData(form);
    data.delete("files"); files.forEach((f) => data.append("files", f)); data.set("elapsed_ms", String(Date.now() - opened.current)); data.set("enquiry_type", type);
    setError(""); setState("sending");
    try {
      const res = await fetch("/api/support/contact", { method: "POST", body: data });
      const body = await res.json().catch(() => ({}));
      if (res.status === 202) { setReference(typeof body?.reference === "string" ? body.reference : ""); setFilesFailed(Boolean(body?.filesFailed)); setState("sent"); form.reset(); setFiles([]); return; }
      setError(typeof body?.error === "string" ? body.error : "We could not send your message. Please try again.");
    } catch { setError("We could not reach the server. Check your connection and try again."); }
    setState("idle");
  }

  if (state === "sent") return (
    <div className="qbp-notice" role="status" data-qb-intake="contact" data-qb-intake-status="SENT">
      <strong>Thank you. Your message has been received.</strong>
      {reference && <span style={{ display: "block" }}>Your reference is <strong>{reference}</strong>. Please keep it if you write to us again.</span>}
      {filesFailed && <span style={{ display: "block" }}>We could not save your attachments. Please tell us when we reply and we will arrange another way to send them.</span>}
      <span style={{ display: "block" }}>We will reply to the email address you gave, usually within 3 working days.</span>
    </div>
  );
  return (
    <form className="qbp-form qb-form" data-qb-intake="contact" data-qb-intake-status="OPEN" onSubmit={onSubmit}>
      <fieldset disabled={state === "sending"} className="qbp-fieldset">
        <legend className="qbp-sr-only">Your details</legend>
        <div className="qbp-form-grid">
          <div className="qb-field"><label htmlFor="qbp-contact-name">Full name</label><input id="qbp-contact-name" name="name" type="text" required autoComplete="name" maxLength={120} /></div>
          <div className="qb-field"><label htmlFor="qbp-contact-email">Email</label><input id="qbp-contact-email" name="email" type="email" required autoComplete="email" maxLength={200} /></div>
          <div className="qb-field"><label htmlFor="qbp-contact-type">Enquiry type</label>
            <select id="qbp-contact-type" required value={type} onChange={(e) => setType(e.target.value)}><option value="" disabled>Select…</option>{CONTACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
          <div className="qb-field" style={{ gridColumn: "1 / -1" }}><label htmlFor="qbp-contact-message">Message</label>
            <textarea id="qbp-contact-message" name="message" required minLength={10} maxLength={5000} rows={6} />
            {type === "Payment or refund" && <span className="qb-muted qb-small">For a payment, include the Paystack reference, the date and the amount. See our <a className="qbp-link" href="/refunds">refund policy</a>.</span>}</div>
          <div style={{ gridColumn: "1 / -1" }}><AttachPicker files={files} onChange={setFiles} disabled={state === "sending"} /></div>
        </div>
        {/* Honeypot: invisible to people and to screen readers; a bot that fills it is silently dropped. */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
          <label>Leave this empty<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
        </div>
        <label className="qbp-check" style={{ marginTop: 14 }}><input type="checkbox" name="consent" required />I agree that QuizBox may use these details and files to respond to my enquiry, as described in the <a className="qbp-link" href="/privacy">Privacy Notice</a>.</label>
        {error && <p role="alert" className="qb-error" style={{ marginTop: 10 }}>{error}</p>}
        <div className="qbp-actions" style={{ marginTop: 14 }}>
          <button type="submit" className="qbp-btn" disabled={state === "sending" || !type}>{state === "sending" ? "Sending…" : "Send enquiry"}</button>
        </div>
      </fieldset>
    </form>
  );
}
