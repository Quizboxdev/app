"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ArrowRight, HelpCircle } from "lucide-react";
import {
  getPlatformOverview,
  getContentHealth,
  getCompetitionMetrics,
  getOperationsHealth,
} from "@/lib/api/admin";
import StatCard from "@/components/StatCard";
import DistributionBars from "@/components/charts/DistributionBars";

type Attention = { label: string; value: unknown; href: string; action: string };

export default function AdminHomePage() {
  const [overview, setOverview] = useState<any>(null);
  const [content, setContent] = useState<any>(null);
  const [competition, setCompetition] = useState<any>(null);
  const [ops, setOps] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    Promise.all([
      getPlatformOverview().catch(() => null),
      getContentHealth().catch(() => null),
      getCompetitionMetrics().catch(() => null),
      getOperationsHealth().catch(() => null),
    ])
      .then(([o, c, comp, op]) => {
        setOverview(o);
        setContent(c);
        setCompetition(comp);
        setOps(op);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, []);

  const head = (
    <div className="qb-page-head">
      <div>
        <h1>Platform dashboard</h1>
        <p>Exceptions, health and throughput across markets, content and competitions.</p>
      </div>
    </div>
  );

  if (error) return <>{head}<div className="qb-card qb-error" role="alert">{error}</div></>;
  if (busy) return <>{head}<div className="qb-card qb-empty" aria-busy="true">Loading platform metrics…</div></>;

  const toRows = (source: Record<string, unknown> | undefined) =>
    source ? Object.entries(source).map(([name, value]) => ({ name, value: Number(value) || 0 })) : [];
  const usersByRole = toRows(overview?.users?.by_role);
  const usersByMarket = toRows(overview?.users?.by_market);

  const attention: Attention[] = [
    { label: "Unresolved source issues", value: ops?.unresolved_source_issues, href: "/admin/curriculum-sources", action: "Review sources" },
    { label: "Unresolved compensation", value: ops?.unresolved_compensation, href: "/admin/compensation", action: "Resolve" },
    { label: "Markets still configuring", value: overview?.markets?.configuring, href: "/admin/market-setup", action: "Open setup" },
  ];
  const open = attention.filter((item) => Number(item.value) > 0);
  const unknown = attention.filter((item) => item.value === null || item.value === undefined);

  return (
    <>
      {head}

      <section className="qb-card qb-attention" aria-labelledby="attention-heading">
        <div className="qb-page-head">
          <h2 id="attention-heading">Needs attention</h2>
          {open.length === 0 && unknown.length === 0 && <span className="qb-pill success"><CheckCircle2 size={13} aria-hidden="true" />All clear</span>}
        </div>
        <div className="qb-attention-list">
          {attention.map((item) => {
            const count = Number(item.value);
            const known = item.value !== null && item.value !== undefined;
            return (
              <div key={item.label} className="qb-attention-item">
                <span className={`qb-attention-icon ${!known ? "unknown" : count > 0 ? "warn" : "ok"}`} aria-hidden="true">
                  {!known ? <HelpCircle size={16} /> : count > 0 ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                </span>
                <div className="qb-row-main">
                  <strong>{known ? count : "—"}</strong>
                  <span>{item.label}{known ? "" : " · not reported yet"}</span>
                </div>
                {known && count > 0 && <Link className="qb-btn secondary" href={item.href}>{item.action}<ArrowRight size={14} aria-hidden="true" /></Link>}
              </div>
            );
          })}
        </div>
      </section>

      <div className="qb-grid cols-4">
        <StatCard label="Total users" value={overview?.users?.total} />
        <StatCard label="Active markets" value={overview?.markets?.active} />
        <StatCard label="Approved questions" value={content?.approved_questions ?? overview?.content?.questions} />
        <StatCard label="Competitions" value={competition?.total_competitions ?? overview?.competitions?.competitions} />
      </div>

      <div className="qb-grid cols-2">
        <section className="qb-card">
          <h2>Users by role</h2>
          <DistributionBars rows={usersByRole} empty="Role breakdown appears once accounts are reported." />
        </section>
        <section className="qb-card">
          <h2>Users by market</h2>
          <DistributionBars rows={usersByMarket} empty="Market breakdown appears once accounts are reported." />
        </section>
        <section className="qb-card">
          <h2>Content throughput</h2>
          <dl className="qb-stat-list">
            <Metric label="Generation" value={content?.generation_throughput} />
            <Metric label="SME review" value={content?.sme_review_throughput} />
            <Metric label="Source coverage" value={content?.source_coverage != null ? `${content.source_coverage}%` : null} />
          </dl>
          <div className="qb-card-links">
            <Link href="/admin/content">Content operations</Link>
            <Link href="/review">SME reviews</Link>
          </div>
        </section>
        <section className="qb-card">
          <h2>Operations</h2>
          <dl className="qb-stat-list">
            <Metric label="Configuring markets" value={overview?.markets?.configuring} />
            <Metric label="Source issues" value={ops?.unresolved_source_issues} />
            <Metric label="Compensation issues" value={ops?.unresolved_compensation} />
          </dl>
          <div className="qb-card-links">
            <Link href="/admin/operations">Platform operations</Link>
            <Link href="/admin/support">Support</Link>
          </div>
        </section>
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: unknown }) {
  const missing = value === null || value === undefined || value === "";
  return (
    <div>
      <dt>{label}</dt>
      <dd className={missing ? "qb-stat-empty" : undefined}>{missing ? "—" : String(value)}</dd>
    </div>
  );
}
