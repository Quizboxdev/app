"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { timeLeft, expiresSoon } from "@/lib/drafts/format";

// The small line shown on a form that is being kept as a draft: what happened, and when it will be removed. It turns into a warning inside the last two hours.
export default function DraftNotice({ restored, expiresAt, noun, onDiscard }: { restored: boolean; expiresAt: string | null; noun: string; onDiscard?: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  if (!expiresAt) return null;
  const soon = expiresSoon(expiresAt, now);
  return (
    <div className="qb-card" role={soon ? "alert" : "status"} style={soon ? { borderColor: "currentColor" } : undefined}>
      <strong>{soon ? `This unfinished ${noun} will be deleted in ${timeLeft(expiresAt, now)}.` : restored ? `We restored your unfinished ${noun}.` : `Your ${noun} is saved as a draft.`}</strong>{" "}
      <span className="qb-muted qb-small">{soon ? "Finish it, or make a change to keep it for another 24 hours. " : `It is kept for ${timeLeft(expiresAt, now)} after your last change, then deleted. `}
        <Link className="qb-link" href="/drafts">All drafts</Link>{onDiscard && <> · <button type="button" className="qb-link-btn" onClick={onDiscard}>Discard this draft</button></>}</span>
    </div>
  );
}
