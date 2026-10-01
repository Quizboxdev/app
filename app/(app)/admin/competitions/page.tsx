"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import { getCompetitionMetrics } from "@/lib/api/admin";

export default function AdminCompetitionsPage() {
  const [m, setM] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getCompetitionMetrics()
      .then(setM)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (!m) return <div>Loading competition metrics…</div>;

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Competition Operations</h1>
          <p>Interschool participation, teams, results and sponsorship.</p>
        </div>
      </div>

      <div className="qb-grid cols-4">
        <StatCard value={m.competitions ?? 0} label="Competitions" />
        <StatCard value={m.schools_registered ?? 0} label="School registrations" />
        <StatCard value={m.teams ?? 0} label="Teams" />
        <StatCard value={m.results ?? 0} label="Results" />
      </div>

      <div style={{ height: 18 }} />

      <div className="qb-grid cols-3">
        <StatCard value={m.matches ?? 0} label="Matches" />
        <StatCard value={m.appeals_open ?? 0} label="Open appeals" />
        <StatCard value={m.sponsors ?? 0} label="Sponsors" />
      </div>
    </>
  );
}
