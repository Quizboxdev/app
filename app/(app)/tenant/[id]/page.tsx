"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import StatCard from "@/components/StatCard";
import {
  getTenantDashboard,
  getTenantLearningMetrics,
  getTenantBranding,
  getTenantFeatures,
} from "@/lib/api/tenant";

export default function TenantDashboardPage() {
  const params = useParams<{ id: string }>();
  const [dash, setDash] = useState<any>(null);
  const [learning, setLearning] = useState<any>(null);
  const [branding, setBranding] = useState<any>(null);
  const [features, setFeatures] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      getTenantDashboard(params.id),
      getTenantLearningMetrics(params.id, 30),
      getTenantBranding(params.id),
      getTenantFeatures(params.id),
    ])
      .then(([d, l, b, f]) => {
        setDash(d);
        setLearning(l);
        setBranding(b);
        setFeatures(f);
      })
      .catch((e) => setError(e.message));
  }, [params.id]);

  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (!dash || !learning) return <div>Loading tenant dashboard…</div>;

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>{dash.tenant?.name ?? "Tenant"}</h1>
          <p>
            {branding?.display_name ?? dash.tenant?.code} · {dash.tenant?.status}
          </p>
        </div>
      </div>

      <div className="qb-grid cols-4">
        <StatCard value={dash.members ?? 0} label="Members" />
        <StatCard value={dash.classes ?? 0} label="Classes" />
        <StatCard value={dash.questions ?? 0} label="Questions" />
        <StatCard value={dash.assessments ?? 0} label="Assessments" />
      </div>

      <div style={{ height: 18 }} />

      <div className="qb-grid cols-3">
        <StatCard value={learning.completed_attempts ?? 0} label="Completed attempts / 30d" />
        <StatCard value={`${Math.round(Number(learning.average_percentage ?? 0))}%`} label="Average score" />
        <StatCard value={`${Math.round(Number(learning.pass_rate ?? 0))}%`} label="Pass rate" />
      </div>

      <div style={{ height: 18 }} />

      <div className="qb-card">
        <h2>Enabled features</h2>
        <div className="qb-list">
          {features.map((f) => (
            <div className="qb-row" key={f.id}>
              <div className="qb-row-main">
                <strong>{f.feature_code}</strong>
              </div>
              <span className={`qb-pill ${f.enabled ? "success" : "warning"}`}>
                {f.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
