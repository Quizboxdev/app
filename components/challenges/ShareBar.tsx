"use client";

import { useState } from "react";
import { Copy, Share2 } from "lucide-react";
import { FORMATS, formatOf } from "@/lib/challenges/types";

// Share a challenge or competition: WhatsApp, Facebook, X, Telegram, copy the link, or the phone's own share sheet. Each share is counted for the organiser.
// Nobody can take part without an account, so the message says so; the link works for anyone, and signing up brings them straight back to it.
export default function ShareBar({ slug, title, format, code }: { slug: string; title: string; format?: string; code?: string | null }) {
  const [copied, setCopied] = useState(false);
  const f = FORMATS[formatOf(format)];
  const url = () => `${window.location.origin}${f.base}/${slug}`;
  const message = () => `Join me in "${title}" on QuizBox. Sign up free and take part: ${url()}${code ? ` (access code ${code})` : ""}`;
  const count = () => { try { void fetch("/api/challenges/view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, event: "share" }), keepalive: true }); } catch { /* counting a share is optional */ } };
  const open = (href: string) => { count(); window.open(href, "_blank", "noopener,noreferrer"); };
  const enc = encodeURIComponent;
  async function copy() {
    count();
    try { await navigator.clipboard.writeText(message()); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt("Copy this message", message()); }
  }
  async function native() { try { await navigator.share({ title, text: message() }); count(); } catch { /* cancelled */ } }
  const canNative = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <div className="qb-card" aria-label={`Share this ${f.noun}`}>
      <h2 style={{ display: "flex", gap: 8, alignItems: "center" }}><Share2 size={18} aria-hidden="true" /> Share this {f.noun}</h2>
      <p className="qb-muted qb-small">Friends need a free account to join. After they sign up they come straight back here.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="qb-btn" onClick={() => open(`https://wa.me/?text=${enc(message())}`)}>WhatsApp</button>
        <button type="button" className="qb-btn qb-btn-secondary" onClick={() => open(`https://www.facebook.com/sharer/sharer.php?u=${enc(url())}`)}>Facebook</button>
        <button type="button" className="qb-btn qb-btn-secondary" onClick={() => open(`https://twitter.com/intent/tweet?text=${enc(`Join me in "${title}" on QuizBox`)}&url=${enc(url())}`)}>X</button>
        <button type="button" className="qb-btn qb-btn-secondary" onClick={() => open(`https://t.me/share/url?url=${enc(url())}&text=${enc(`Join me in "${title}" on QuizBox`)}`)}>Telegram</button>
        <button type="button" className="qb-btn qb-btn-secondary" onClick={() => void copy()}><Copy size={14} aria-hidden="true" /> {copied ? "Copied" : "Copy link"}</button>
        {canNative && <button type="button" className="qb-btn qb-btn-secondary" onClick={() => void native()}>More…</button>}
      </div>
    </div>
  );
}
