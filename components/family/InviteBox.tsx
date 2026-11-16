"use client";

import { useState } from "react";
import { joinUrl } from "@/lib/api/family";

// The child's single-use link, shown once. The parent copies it or sends it by WhatsApp; it works one time, for seven days, and a new link replaces it.
export default function InviteBox({ name, token, expiresAt, username }: { name: string; token: string; expiresAt?: string; username?: string }) {
  const [copied, setCopied] = useState(false);
  const link = joinUrl(typeof window === "undefined" ? "https://quizbox.io" : window.location.origin, token);
  const text = `Hi ${name}, open your QuizBox workspace and choose your password: ${link}`;
  async function copy() { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setCopied(false); } }
  return (
    <section className="qb-card" role="status" aria-label={`Invitation link for ${name}`} style={{ display: "grid", gap: 8, borderColor: "var(--blue)" }}>
      <h3 style={{ margin: 0 }}>{name}&apos;s workspace link</h3>
      {username && <p style={{ margin: 0 }}>Their username is <strong>{username}</strong>. They will choose their own password.</p>}
      <input readOnly value={link} aria-label="Workspace link" onFocus={(e) => e.currentTarget.select()} style={{ width: "100%" }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="qb-btn" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button>
        <a className="qb-btn secondary" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer noopener">Send on WhatsApp</a>
      </div>
      <p className="qb-muted qb-small" style={{ margin: 0 }}>This link works once{expiresAt ? ` and expires on ${new Date(expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}` : ""}. It is not shown again: if it is lost, make a new one from the child&apos;s page.</p>
    </section>
  );
}
