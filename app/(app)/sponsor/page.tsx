
"use client";

import { useEffect, useState } from "react";
import { bootstrapUser } from "@/lib/auth";
import CompetitionContentScope from "@/components/CompetitionContentScope";
import StatCard from "@/components/StatCard";
import {
  getMySponsorProfile,
  getSponsorCompetitions,
  getSponsorParticipationFunnel,
  getSponsorScoreDistribution,
  getSponsorDemographics,
  getSponsorQuestionPerformance
} from "@/lib/api/sponsor";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, CartesianGrid, XAxis, YAxis } from "recharts";

export default function SponsorPage() {
  const [profile, setProfile] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [funnel, setFunnel] = useState<any>(null);
  const [scoreDist, setScoreDist] = useState<any>([]);
  const [demographics, setDemographics] = useState<any>(null);
  const [questionPerf, setQuestionPerf] = useState<any>([]);
  
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    bootstrapUser()
      .then(async (ctx) => {
        const sponsor = await getMySponsorProfile(ctx.userId);
        if (!sponsor) throw new Error("Sponsor profile not found.");
        setProfile(sponsor);
        
        const [r, f, sd, d, qp] = await Promise.all([
          getSponsorCompetitions(sponsor.id),
          getSponsorParticipationFunnel(sponsor.id).catch(() => null),
          getSponsorScoreDistribution(sponsor.id).catch(() => []),
          getSponsorDemographics(sponsor.id).catch(() => null),
          getSponsorQuestionPerformance(sponsor.id).catch(() => [])
        ]);
        
        setRows(r);
        setFunnel(f);
        setScoreDist(sd);
        setDemographics(d);
        setQuestionPerf(qp);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, []);

  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (busy) return (
    <div className="qb-home" aria-busy="true">
      <div className="qb-page-head">
        <div style={{ width: "120px", height: "24px", background: "var(--qb-surface-muted)", borderRadius: "4px" }} />
      </div>
      <div className="qb-home-grid">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="qb-card" style={{ minHeight: "150px", background: "var(--qb-surface)", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ width: "100%", height: "100%", background: "var(--qb-surface-muted)", borderRadius: "8px" }} />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div className="qb-page-head">
        <div>
          <h1>{profile.organization_name ?? profile.contact_name ?? "Sponsor"}</h1>
          <p>Sponsorship and competition impact workspace.</p>
        </div>
      </div>

      <div className="qb-grid cols-4">
        <StatCard value={rows.length} label="Active Sponsorships" />
        <StatCard value={rows.reduce((sum, r) => sum + Number(r.committed_amount ?? 0), 0).toFixed(2)} label={`Total Committed (${rows[0]?.currency ?? "USD"})`} />
        
        <StatCard value={funnel?.registrations || "0"} label="Total Registrations" />
        <StatCard value={funnel?.drop_off_rate ? `${funnel.drop_off_rate}%` : "0%"} label="Drop Off Rate" />
      </div>

      <div className="qb-grid cols-2">
        <section className="qb-card" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <h2>Participation Funnel</h2>
          {funnel && funnel.registrations > 0 ? (
            <div style={{ padding: "16px 0" }}>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={[
                  { name: "Registered", count: funnel.registrations },
                  { name: "Started", count: funnel.started },
                  { name: "Completed", count: funnel.completed }
                ]} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--qb-border-light)" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={80} />
                  <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid var(--qb-border)" }} />
                  <Bar dataKey="count" fill="var(--qb-primary)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="qb-muted" style={{ padding: "32px 0", textAlign: "center" }}>
              No completed participants yet
            </div>
          )}
        </section>

        <section className="qb-card" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <h2>Score Distribution</h2>
          {scoreDist && scoreDist.length > 0 ? (
             <div style={{ padding: "16px 0" }}>
               <ResponsiveContainer width="100%" height={250}>
                 <BarChart data={scoreDist}>
                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--qb-border-light)" />
                   <XAxis dataKey="label" />
                   <YAxis />
                   <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid var(--qb-border)" }} />
                   <Bar dataKey="value" fill="var(--qb-success)" radius={[4, 4, 0, 0]} />
                 </BarChart>
               </ResponsiveContainer>
             </div>
          ) : (
            <div className="qb-muted" style={{ padding: "32px 0", textAlign: "center" }}>
              Not enough data to show trend
            </div>
          )}
        </section>
      </div>

      <div className="qb-grid cols-2">
        <section className="qb-card" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <h2>Market & Institution Breakdown</h2>
          {demographics && (demographics.markets?.length > 0 || demographics.institutions?.length > 0) ? (
            <div style={{ padding: "16px 0", display: "flex", gap: "24px" }}>
              <div style={{ flex: 1, height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={demographics.markets} dataKey="value" nameKey="label" innerRadius={40} outerRadius={60}>
                      {demographics.markets.map((entry: any, i: number) => <Cell key={`cell-${i}`} fill={`var(--qb-primary)`} opacity={1 - (i * 0.2)} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ textAlign: "center", fontSize: "0.875rem", fontWeight: 600 }}>Markets</div>
              </div>
            </div>
          ) : (
            <div className="qb-muted" style={{ padding: "32px 0", textAlign: "center" }}>
              Not enough data to show trend
            </div>
          )}
        </section>

        <section className="qb-card" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <h2>Question Performance</h2>
          {questionPerf && questionPerf.length > 0 ? (
            <div className="qb-list">
              {questionPerf.slice(0, 5).map((q: any, idx: number) => (
                <div key={idx} className="qb-row">
                  <div className="qb-row-main">
                    <strong>{q.label}</strong>
                    <span>Difficulty: {q.difficulty}</span>
                  </div>
                  <div><strong>{q.percentage}%</strong></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="qb-muted" style={{ padding: "32px 0", textAlign: "center" }}>
              Not enough data to show trend
            </div>
          )}
        </section>
      </div>

      <CompetitionContentScope/>

      <section className="qb-card">
        <h2>Linked Competitions</h2>
        <div className="qb-list" style={{ marginTop: "16px" }}>
          {rows.map((row) => (
            <div className="qb-row" key={row.id}>
              <div className="qb-row-main">
                <strong>{row.competitions?.title ?? "Competition"}</strong>
                <span>{row.sponsorship_role} · {row.status}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <strong>
                  {row.currency} {Number(row.committed_amount ?? 0).toFixed(2)}
                </strong>
              </div>
            </div>
          ))}

          {!rows.length && (
            <div className="qb-card qb-muted">
              No competition sponsorships are linked yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
