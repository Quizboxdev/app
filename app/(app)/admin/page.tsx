"use client";

import HomeSections from "@/components/HomeSections";
import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import {
  getPlatformOverview,
  getEventSummary,
  listFeatureFlags,
} from "@/lib/api/admin";

export default function AdminHomePage() {
  const [overview, setOverview] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [flags, setFlags] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      getPlatformOverview(),
      getEventSummary(30),
      listFeatureFlags(),
    ])
      .then(([o, e, f]) => {
        setOverview(o);
        setEvents(e);
        setFlags(f);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (!overview) return <div>Loading platform overview…</div>;

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Platform Administration</h1>
          <p>QuizBox operating overview.</p>
        </div>
      </div>
      <HomeSections/>

      <div className="qb-grid cols-4">
        <StatCard value={overview.users?.total ?? 0} label="Users" />
        <StatCard value={overview.institutions?.total ?? 0} label="Institutions" />
        <StatCard value={overview.content?.questions ?? 0} label="Questions" />
        <StatCard value={overview.competitions?.competitions ?? 0} label="Competitions" />
      </div>

      <div style={{ height: 18 }} />

      <div className="qb-grid cols-2">
        <div className="qb-card">
          <h2>30-day events</h2>
          <div className="qb-list">
            {events.slice(0, 12).map((row) => (
              <div className="qb-row" key={row.event_name}>
                <div className="qb-row-main">
                  <strong>{row.event_name}</strong>
                  <span>{row.unique_users} unique users</span>
                </div>
                <strong>{row.event_count}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="qb-card">
          <h2>Feature flags</h2>
          <div className="qb-list">
            {flags.map((flag) => (
              <div className="qb-row" key={flag.id}>
                <div className="qb-row-main">
                  <strong>{flag.feature_code}</strong>
                  <span>{flag.enabled ? "Enabled" : "Disabled"}</span>
                </div>
                <span className={`qb-pill ${flag.enabled ? "success" : "warning"}`}>
                  {flag.enabled ? "ON" : "OFF"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
