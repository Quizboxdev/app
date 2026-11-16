"use client";

import { useEffect, useState } from "react";
import LoadError from "@/components/LoadError";
import Link from "next/link";
import { Kpi, num } from "@/components/admin/DataViz";
import { useSponsorEngine } from "@/components/SponsorEngineFlag";
import { getCompetitionMetrics } from "@/lib/api/admin";
import ExportLink from "@/components/admin/ExportLink";

export default function AdminCompetitionsPage() {
  const sponsorEngine = useSponsorEngine();
  const [m, setM] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getCompetitionMetrics()
      .then(setM)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <LoadError message={error} onRetry={() => window.location.reload()} />;
  if (!m) return <div className="dx-page"><p className="dx-muted">Loading competition metrics…</p></div>;

  return (
    <div className="dx-page">
      <div className="dx-head">
        <div>
          <h1>Competition Operations</h1>
          <p>Interschool participation, teams, results and sponsorship.</p>
        </div>
        <div className="dx-actions">
          <ExportLink dataset="challenges" label="Export challenges" />
          {sponsorEngine && <><Link className="dx-btn sm" href="/admin/competitions/assignments">Review assignment</Link><Link className="dx-btn sm" href="/admin/competitions/oversight">Sponsor oversight</Link></>}
        </div>
      </div>

      <div className="dx-kpis">
        <Kpi label="Competitions" value={num(m.competitions ?? 0)} />
        <Kpi label="School registrations" value={num(m.schools_registered ?? 0)} />
        <Kpi label="Teams" value={num(m.teams ?? 0)} />
        <Kpi label="Results" value={num(m.results ?? 0)} />
        <Kpi label="Matches" value={num(m.matches ?? 0)} />
        <Kpi label="Open appeals" value={num(m.appeals_open ?? 0)} tone={(m.appeals_open ?? 0) > 0 ? "warn" : "default"} />
        <Kpi label="Sponsors" value={num(m.sponsors ?? 0)} />
      </div>
    </div>
  );
}
