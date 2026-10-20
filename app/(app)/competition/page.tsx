"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listCompetitions } from "@/lib/api/competition";
import { openCompetitions } from "@/lib/api/challenges";
import type { PublicChallenge } from "@/lib/challenges/types";

export default function CompetitionPage() {
  const [rows, setRows] = useState<any[]>([]), [open, setOpen] = useState<PublicChallenge[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    openCompetitions("COMPETITION").then(setOpen).catch(() => setOpen([]));
    listCompetitions().then(setRows).catch((e) => setError(e.message)).finally(() => setLoaded(true));
  }, []);

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Competitions</h1>
          <p>Competitions have rounds: the best players go through to the next round until a winner is found. Anyone can run one and share the link.</p>
        </div>
        <div><Link className="qb-btn" href="/creator?format=competition">Run a competition</Link></div>
      </div>

      {open.length > 0 && <>
        <h2>Open to join</h2>
        <div className="qb-grid cols-3">
          {open.map((c) => (
            <div className="qb-card" key={c.slug}>
              <span className="qb-pill">{(c.stage_count ?? 1) > 1 ? `${c.stage_count} rounds` : "Competition"}</span>
              <h3 style={{ marginTop: 14 }}>{c.title}</h3>
              <p className="qb-muted">{c.summary}</p>
              <div className="qb-small qb-muted">{c.question_count} questions · {c.participants} played</div>
              <div style={{ marginTop: 15 }}><Link className="qb-btn ghost" href={`/competitions/${c.slug}`}>View competition</Link></div>
            </div>
          ))}
        </div>
      </>}
      <h2>Sponsored competitions</h2>

      {error && <div className="qb-card qb-error">{error}</div>}
      {loaded && !error && !rows.length && <div className="qb-card"><div className="qb-empty"><strong>No sponsored competitions yet</strong>Sponsored competitions appear here when they are announced.</div></div>}

      <div className="qb-grid cols-3">
        {rows.map((row) => (
          <div className="qb-card" key={row.id}>
            <span className="qb-pill">{row.competition_type ?? "COMPETITION"}</span>
            <h3 style={{ marginTop: 14 }}>{row.title}</h3>
            <p className="qb-muted">{row.description ?? ""}</p>
            <div className="qb-small qb-muted">
              {row.subject_code ?? ""} {row.grade ?? ""}
            </div>
            <div style={{ marginTop: 15 }}>
              <Link className="qb-btn ghost" href={`/competition/${row.id}`}>
                Open competition
              </Link>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
