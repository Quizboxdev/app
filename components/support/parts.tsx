"use client";

import { useRef, useState } from "react";
import { openFile, STATUS, type FileRef, type Message, type Status } from "@/lib/api/support";

// Small pieces shared by "My requests" and the staff queue: choosing attachments, showing a conversation.
export const MAX_FILES = 3, MAX_BYTES = 5 * 1024 * 1024;
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function StatusChip({ status }: { status: Status }) {
  return <span className={`qb-badge${status === "resolved" || status === "closed" ? "" : " qb-badge-accent"}`} style={{ padding: "2px 8px", borderRadius: 999, fontSize: 12, border: "1px solid currentColor" }}>{STATUS[status]}</span>;
}

export function AttachPicker({ files, onChange, disabled }: { files: File[]; onChange: (f: File[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null), [error, setError] = useState("");
  function add(list: FileList | null) {
    if (!list) return; setError("");
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= MAX_FILES) { setError(`You can attach up to ${MAX_FILES} files.`); break; }
      if (f.size > MAX_BYTES) { setError(`"${f.name}" is larger than 5 MB.`); continue; }
      if (!/\.(png|jpe?g|webp|pdf)$/i.test(f.name)) { setError(`"${f.name}" is not an image or PDF.`); continue; }
      next.push(f);
    }
    onChange(next);
  }
  return (
    <div>
      <input ref={input} type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <button type="button" className="qb-btn qb-btn-secondary" disabled={disabled || files.length >= MAX_FILES} onClick={() => input.current?.click()}>Attach a screenshot or PDF</button>
      <span className="qb-muted qb-small"> Up to {MAX_FILES} files, 5 MB each (PNG, JPEG, WebP or PDF).</span>
      {files.length > 0 && <ul className="qb-list" style={{ margin: "8px 0 0" }}>{files.map((f, i) => <li key={`${f.name}-${i}`}>{f.name} <span className="qb-muted qb-small">({kb(f.size)})</span> <button type="button" className="qb-btn ghost" style={{ minHeight: 0, padding: "0 6px" }} onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>Remove</button></li>)}</ul>}
      {error && <p role="alert" className="qb-error" style={{ margin: "6px 0 0" }}>{error}</p>}
    </div>
  );
}

export function FileChips({ files, onError }: { files: FileRef[]; onError: (m: string) => void }) {
  if (!files.length) return null;
  return <p style={{ margin: "6px 0 0", display: "flex", gap: 8, flexWrap: "wrap" }}>{files.map((f) => <button key={f.id} type="button" className="qb-btn qb-btn-secondary" style={{ minHeight: 0, padding: "2px 10px" }} onClick={() => { onError(""); openFile(f.id).catch((e) => onError(e.message)); }}>{f.file_name} ({kb(f.size_bytes)})</button>)}</p>;
}

export function Thread({ messages, looseFiles = [], staffView = false, onError }: { messages: Message[]; looseFiles?: FileRef[]; staffView?: boolean; onError: (m: string) => void }) {
  return (
    <div style={{ display: "grid", gap: 10 }} aria-label="Conversation">
      {messages.map((m) => (
        <article key={m.id} className="qb-card" style={{ margin: 0, borderLeft: `4px solid ${m.internal ? "#b45309" : m.author_kind === "staff" ? "#2563eb" : "rgba(128,128,128,.5)"}` }}>
          <p className="qb-muted qb-small" style={{ margin: 0 }}><strong>{m.internal ? "Internal note (only staff see this)" : m.author_kind === "staff" ? (staffView ? "Support" : "QuizBox support") : staffView ? "Requester" : "You"}</strong> · {when(m.created_at)}</p>
          <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.body}</p>
          <FileChips files={m.files} onError={onError} />
        </article>
      ))}
      {looseFiles.length > 0 && <div className="qb-card" style={{ margin: 0 }}><p className="qb-muted qb-small" style={{ margin: 0 }}>Other files</p><FileChips files={looseFiles} onError={onError} /></div>}
    </div>
  );
}
