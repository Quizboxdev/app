"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { myAttempts, myAwards } from "@/lib/api/challenges";
import { formatDuration } from "@/lib/challenges/types";

// A player's own history: every attempt, and any prizes they have won with their delivery status.
export default function MyChallengesPage() {
  const [attempts, setAttempts] = useState<Awaited<ReturnType<typeof myAttempts>> | null>(null), [awards, setAwards] = useState<Awaited<ReturnType<typeof myAwards>>>([]), [error, setError] = useState("");
  useEffect(() => { myAttempts().then(setAttempts).catch((e) => { setError(e.message); setAttempts([]); }); myAwards().then(setAwards).catch(() => setAwards([])); }, []);
  return (
    <>
      <div className="qb-page-head"><div><h1>My challenges</h1><p>Your attempts and prizes. <Link className="qb-link" href="/open">Find a challenge to play</Link>.</p></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {awards.length > 0 && <div className="qb-card"><h2>Prizes</h2><ul className="qb-list">{awards.map((a, i) => <li key={i}><strong>{a.prize}</strong> in {a.campaign} (rank {a.rank}) · <span>{a.status.toLowerCase()}</span>{a.details ? <span className="qb-muted"> · {a.details}</span> : null}</li>)}</ul>
        <p className="qb-muted qb-small">The organiser will contact you at your account email to arrange delivery.</p></div>}
      <div className="qb-card">
        <h2>Attempts</h2>
        {attempts === null ? <p className="qb-muted">Loading…</p> : attempts.length === 0 ? <p className="qb-muted">You have not played a challenge yet.</p> : (
          <table className="qb-table"><thead><tr><th>Challenge</th><th>Try</th><th>Score</th><th>Time</th><th>Played</th></tr></thead><tbody>
            {attempts.map((a, i) => <tr key={i}><td><Link className="qb-link" href={`/play/${a.slug}`}>{a.title}</Link></td><td>{a.attempt_no}</td>
              <td>{a.submitted_at ? (a.expired ? "Timed out" : `${a.score}/${a.max_score}`) : "Not finished"}</td><td>{a.duration_ms ? formatDuration(a.duration_ms) : ""}</td><td>{new Date(a.started_at).toLocaleDateString("en-GB")}</td></tr>)}
          </tbody></table>
        )}
      </div>
    </>
  );
}
