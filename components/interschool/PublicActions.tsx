"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { campaignLink, sourceParam, whatsappHref, whatsappMessage } from "@/lib/interschool/text";

// Register and share buttons on a public competition page. The page itself is cached, so the link's source (?src=qr and so on) is read in the browser,
// carried to registration, and counted once per visit.
const track = (slug: string, kind: "view" | "share", source: string) => {
  try { void fetch("/api/interschool/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, kind, source }), keepalive: true }); } catch { /* a missed count is harmless */ }
};

export default function PublicActions({ slug, title, closes, sponsor, canRegister, state }: { slug: string; title: string; closes: string | null; sponsor: string | null; canRegister: boolean; state: string }) {
  const source = sourceParam(useSearchParams().get("src"));
  const [copied, setCopied] = useState(false);
  useEffect(() => { track(slug, "view", source); }, [slug, source]);
  const link = (kind: "LINK" | "WHATSAPP" | "SOCIAL") => campaignLink(window.location.origin, slug, kind);
  const share = (href: string) => { track(slug, "share", source); window.open(href, "_blank", "noopener,noreferrer"); };
  async function copy() {
    track(slug, "share", source);
    try { await navigator.clipboard.writeText(link("LINK")); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt("Copy this link", link("LINK")); }
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {canRegister
        ? <p><Link className="qbp-btn" href={`/interschool/join/${slug}?src=${source.toLowerCase()}`}>Register</Link> <span className="qbp-meta">You need a free QuizBox account. Teachers enter learners from the same page.</span></p>
        : <p className="qbp-notice qbp-notice-info" role="status"><strong>{state}.</strong> New registrations are not being accepted.</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} aria-label="Share this competition">
        <button type="button" className="qbp-btn" onClick={() => share(whatsappHref(whatsappMessage(title, link("WHATSAPP"), closes, sponsor)))}>Share on WhatsApp</button>
        <button type="button" className="qbp-btn" onClick={() => share(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link("SOCIAL"))}`)}>Facebook</button>
        <button type="button" className="qbp-btn" onClick={() => void copy()}>{copied ? "Link copied" : "Copy campaign link"}</button>
      </div>
    </div>
  );
}
