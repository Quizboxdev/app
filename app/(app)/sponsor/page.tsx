
"use client";

import { useEffect, useState } from "react";
import { bootstrapUser } from "@/lib/auth";
import CompetitionContentScope from "@/components/CompetitionContentScope";
import StatCard from "@/components/StatCard";
import DistributionBars from "@/components/charts/DistributionBars";
import StatusBadge from "@/components/StatusBadge";
import { humanize } from "@/lib/format";
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
  if (busy) return <div className="qb-home-grid" aria-busy="true">{[1, 2, 3, 4].map((i) => <div key={i} className="qb-card qb-skeleton" />)}</div>;

  const empty = (title: string, body: string) => <div className="qb-empty"><strong>{title}</strong>{body}</div>;
  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  const toRows = (items: any[] | undefined) => (items ?? []).map((item: any) => ({ name: String(item.label ?? item.name ?? "Unknown"), value: Number(item.value ?? item.count ?? 0) }));

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>{profile.organization_name ?? profile.contact_name ?? "Sponsor"}</h1>
          <p>Sponsorship and competition impact workspace.</p>
        </div>
      </div>

      <div className="qb-grid cols-4">
        <StatCard value={rows.length} label="Active sponsorships" />
        <StatCard value={rows.reduce((sum, r) => sum + Number(r.committed_amount ?? 0), 0).toFixed(2)} label={`Total committed (${rows[0]?.currency ?? "USD"})`} />
        
        <StatCard value={funnel?.registrations || "0"} label="Registrations" />
        <StatCard value={funnel?.drop_off_rate ? `${funnel.drop_off_rate}%` : "0%"} label="Drop-off rate" />
      </div>

      <div className="qb-grid cols-2">
        <section className="qb-card">
          <h2>Participation funnel</h2>
          {funnel && funnel.registrations > 0 ? (
            <ol className="qb-funnel">
              {[
                { name: "Registered", value: Number(funnel.registrations) },
                { name: "Started", value: Number(funnel.started ?? 0) },
                { name: "Completed", value: Number(funnel.completed ?? 0) },
              ].map((step) => (
                <li key={step.name}>
                  <span className="qb-dist-name">{step.name}</span>
                  <span className="qb-dist-track" aria-hidden="true"><span className="qb-dist-fill" style={{ width: `${Math.max(4, pct(step.value, Number(funnel.registrations)))}%` }} /></span>
                  <span className="qb-dist-value">{step.value.toLocaleString()} <span className="qb-muted">· {pct(step.value, Number(funnel.registrations))}%</span></span>
                </li>
              ))}
            </ol>
          ) : empty("No participants yet", "Registrations, starts and completions appear once a sponsored competition opens.")}
        </section>

        <section className="qb-card">
          <h2>Score distribution</h2>
          {scoreDist && scoreDist.length > 0 ? (
             <div>
               <ResponsiveContainer width="100%" height={180}>
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
            empty("No scores yet", "Scores appear once participants complete an attempt.")
          )}
        </section>
      </div>

      <div className="qb-grid cols-2">
        <section className="qb-card">
          <h2>Reach by market and institution</h2>
          {demographics && (demographics.markets?.length > 0 || demographics.institutions?.length > 0) ? (
            <div className="qb-split">
              <div><h3 className="qb-overline">Markets</h3><DistributionBars rows={toRows(demographics.markets)} empty="No market data yet." /></div>
              <div><h3 className="qb-overline">Institutions</h3><DistributionBars rows={toRows(demographics.institutions).slice(0, 6)} empty="No institution data yet." /></div>
            </div>
          ) : empty("No reach data yet", "Market and institution reach appears once participants register.")}
        </section>

        <section className="qb-card">
          <h2>Question performance</h2>
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
            empty("No scores yet", "Scores appear once participants complete an attempt.")
          )}
        </section>
      </div>

      <CompetitionContentScope/>

      <section className="qb-card">
        <h2>Linked competitions</h2>
        <div className="qb-list">
          {rows.map((row) => (
            <div className="qb-row" key={row.id}>
              <div className="qb-row-main">
                <strong>{row.competitions?.title ?? "Competition"}</strong>
                <span>{humanize(row.sponsorship_role)} · <StatusBadge status={row.status} /></span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <strong>
                  {row.currency} {Number(row.committed_amount ?? 0).toFixed(2)}
                </strong>
              </div>
            </div>
          ))}

          {!rows.length && empty("No sponsorships linked yet", "Competitions you sponsor appear here once QuizBox links them to your organization.")}
        </div>
      </section>
    </>
  );
}
