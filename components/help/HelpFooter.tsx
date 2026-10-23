"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// The end of every guide: "Was this helpful?" (counted once per device per hour) and the way to a support request. A view is counted when the guide opens. No personal data is sent.
const SUPPORT_CATEGORY: Record<string, string> = { payments: "payment", classes: "class", assignments: "class", challenges: "challenge", account: "account" };
const track = (slug: string, event: "view" | "yes" | "no") => { try { void fetch("/api/help/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, event }), keepalive: true }); } catch { /* a missed count is harmless */ } };

export default function HelpFooter({ slug, title, category, inApp }: { slug: string; title: string; category: string; inApp: boolean }) {
  const [vote, setVote] = useState<"" | "yes" | "no">("");
  useEffect(() => { track(slug, "view"); }, [slug]);
  const link = inApp ? "qb-link" : "qbp-link";
  const href = inApp ? `/support/new?context=${encodeURIComponent(`Help guide: ${title}`)}&category=${SUPPORT_CATEGORY[category] ?? "other"}` : "/contact";
  return (
    <div className={inApp ? "qb-card" : "qbp-card"} style={{ display: "grid", gap: 10, marginTop: 24 }}>
      {vote === "" ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong>Was this guide helpful?</strong>
          <button type="button" className={inApp ? "qb-btn qb-btn-secondary" : "qbp-btn2"} onClick={() => { setVote("yes"); track(slug, "yes"); }}>Yes</button>
          <button type="button" className={inApp ? "qb-btn qb-btn-secondary" : "qbp-btn2"} onClick={() => { setVote("no"); track(slug, "no"); }}>No</button>
        </div>
      ) : <p role="status" style={{ margin: 0 }}>{vote === "yes" ? "Thank you. We are glad it helped." : "Thank you. Sorry it did not help. Please tell us what was missing."}</p>}
      {(vote === "no" || vote === "") && <p style={{ margin: 0 }}>Still stuck? <Link className={link} href={href}>{inApp ? "Send a support request" : "Contact us"}</Link>{inApp ? ". We will know which guide you were reading." : "."}</p>}
    </div>
  );
}
