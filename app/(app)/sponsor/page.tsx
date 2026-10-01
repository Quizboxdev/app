"use client";

import { useEffect, useState } from "react";
import { bootstrapUser } from "@/lib/auth";
import {
  getMySponsorProfile,
  getSponsorCompetitions,
} from "@/lib/api/sponsor";

export default function SponsorPage() {
  const [profile, setProfile] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    bootstrapUser()
      .then(async (ctx) => {
        const sponsor = await getMySponsorProfile(ctx.userId);
        if (!sponsor) throw new Error("Sponsor profile not found.");
        setProfile(sponsor);
        setRows(await getSponsorCompetitions(sponsor.id));
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (!profile) return <div>Loading sponsor dashboard…</div>;

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>{profile.organization_name ?? profile.contact_name ?? "Sponsor"}</h1>
          <p>Sponsorship and competition impact workspace.</p>
        </div>
      </div>

      <div className="qb-list">
        {rows.map((row) => (
          <div className="qb-row" key={row.id}>
            <div className="qb-row-main">
              <strong>{row.competitions?.title ?? "Competition"}</strong>
              <span>{row.sponsorship_role} · {row.status}</span>
            </div>
            <strong>
              {row.currency} {Number(row.committed_amount ?? 0).toFixed(2)}
            </strong>
          </div>
        ))}

        {!rows.length && (
          <div className="qb-card qb-muted">
            No competition sponsorships are linked yet.
          </div>
        )}
      </div>
    </>
  );
}
