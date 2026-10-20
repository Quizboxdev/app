"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listDrafts, type DraftRow } from "@/lib/api/drafts";
import { expiresSoon, timeLeft } from "@/lib/drafts/format";

// A line across the top of the app whenever some unfinished work will be deleted within two hours (the same moment the notification and email go out).
// Quiet when there is nothing to say, and when the draft holder is not available.
export default function DraftReminder() {
  const [rows, setRows] = useState<DraftRow[]>([]), [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    const load = () => listDrafts().then((r) => { if (alive) setRows(r); }).catch(() => undefined);
    void load();
    const poll = setInterval(load, 5 * 60_000), tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => { alive = false; clearInterval(poll); clearInterval(tick); };
  }, []);
  const soon = rows.filter((r) => expiresSoon(r.expires_at, now)).sort((a, b) => a.expires_at.localeCompare(b.expires_at));
  if (!soon.length) return null;
  return (
    <div className="qb-card" role="alert" style={{ marginBottom: 12 }}>
      <strong>{soon.length === 1 ? `Your unfinished work “${soon[0].title || "Untitled"}” will be deleted in ${timeLeft(soon[0].expires_at, now)}.` : `${soon.length} pieces of unfinished work will be deleted soon, the first in ${timeLeft(soon[0].expires_at, now)}.`}</strong>{" "}
      <Link className="qb-link" href="/drafts">Open drafts</Link>
    </div>
  );
}
