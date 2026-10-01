"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listCompetitions } from "@/lib/api/competition";

export default function CompetitionPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    listCompetitions().then(setRows).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Competitions</h1>
          <p>Individual, school and team QuizBox competitions.</p>
        </div>
      </div>

      {error && <div className="qb-card qb-error">{error}</div>}

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
