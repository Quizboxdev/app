"use client";

import { useState } from "react";
import { Copy, Share2 } from "lucide-react";
import SocialIcon from "@/components/SocialIcon";
import SocialLinks from "@/components/SocialLinks";
import { shareLinks } from "@/lib/public/social";

// "Connect with QuizBox": follow every official channel, and tell friends about QuizBox in one tap (WhatsApp first, because that is where most learners share).
// The shared address is the site the learner is on, so a friend lands on the sign-up page of the same QuizBox.
export default function ConnectCard() {
  const [copied, setCopied] = useState(false);
  const links = () => shareLinks(window.location.origin);
  const open = (href: string) => window.open(href, "_blank", "noopener,noreferrer");
  async function copy() {
    const message = links().message;
    try { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt("Copy this message", message); }
  }
  async function native() { try { await navigator.share({ title: "QuizBox", text: links().message }); } catch { /* cancelled */ } }
  const canNative = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <section className="qb-card qb-connect" aria-labelledby="qb-connect-title">
      <h2 id="qb-connect-title">Connect with QuizBox</h2>
      <p className="qb-muted qb-small">Follow us for tips, new challenges and winners.</p>
      <SocialLinks variant="list" />
      <div className="qb-connect-share">
        <p className="qb-follow-title"><Share2 size={14} aria-hidden="true" /> Tell a friend</p>
        <div className="qb-actions">
          <button type="button" className="qb-btn qb-btn-whatsapp" onClick={() => open(links().whatsapp)}><SocialIcon id="whatsapp" size={16} />WhatsApp</button>
          <button type="button" className="qb-btn secondary" onClick={() => open(links().facebook)}>Facebook</button>
          <button type="button" className="qb-btn secondary" onClick={() => open(links().telegram)}>Telegram</button>
          <button type="button" className="qb-btn secondary" onClick={() => void copy()}><Copy size={14} aria-hidden="true" />{copied ? "Copied" : "Copy link"}</button>
          {canNative && <button type="button" className="qb-btn secondary" onClick={() => void native()}>More…</button>}
        </div>
      </div>
    </section>
  );
}
