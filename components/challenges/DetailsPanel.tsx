"use client";

import { useEffect, useState } from "react";
import { updateCampaign } from "@/lib/api/challenges";
import { FORMATS, formatOf } from "@/lib/challenges/types";

// The wording and the closing time of a challenge, which a creator can still fix after it has gone live. Questions, scoring, rounds and audience stay locked once it is live.
// The opening time can change only until it has opened. Rounds have their own times, so a competition with rounds shows them as read-only.
const toLocal = (iso?: string | null) => { if (!iso) return ""; const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

export default function DetailsPanel({ id, campaign, onChanged, onError }: { id: string; campaign: Record<string, any>; onChanged: () => void; onError: (m: string) => void }) {
  const noun = FORMATS[formatOf(campaign.format)].noun;
  const draft = campaign.status === "DRAFT", ended = ["COMPLETED", "ARCHIVED"].includes(campaign.status);
  const opened = !draft && (!campaign.starts_at || new Date(campaign.starts_at).getTime() <= Date.now());   // an opened challenge keeps its opening time
  const rounds = (campaign.stage_count ?? 1) > 1;
  const [title, setTitle] = useState(""), [summary, setSummary] = useState(""), [opens, setOpens] = useState(""), [closes, setCloses] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  useEffect(() => { setTitle(campaign.title ?? ""); setSummary(campaign.summary ?? ""); setOpens(toLocal(campaign.starts_at)); setCloses(toLocal(campaign.ends_at)); }, [campaign.title, campaign.summary, campaign.starts_at, campaign.ends_at]);
  async function save() {
    setBusy(true); setSaved(false); onError("");
    try {
      const patch: Record<string, unknown> = { title: title.trim(), summary: summary.trim() };
      if (!rounds) { patch.ends_at = toIso(closes); if (!opened) patch.starts_at = toIso(opens); }
      await updateCampaign(id, patch); setSaved(true); onChanged();
    } catch (e: any) { onError(e.message); }
    setBusy(false);
  }
  if (ended) return <div className="qb-card" role="note">This {noun} has ended, so its details can no longer be changed.</div>;
  return (
    <div className="qb-card qb-form">
      <h2>Details</h2>
      <p className="qb-muted">{draft ? `Change the wording and the dates before you publish.` : `You can still correct the title and description and move the closing time. The questions, scoring and rules stay locked while the ${noun} is live, so it stays fair for people who have already played.`}</p>
      <label className="qb-field">Title<input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} required /></label>
      <label className="qb-field">Description<textarea rows={3} maxLength={600} value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
      {rounds ? <p className="qb-muted" role="note">The opening and closing times of each round are set on the Rounds tab and are locked once the {noun} is live.</p> : <>
        <label className="qb-field">Opens{opened ? <span className="qb-muted qb-small"> (already open, so this cannot change)</span> : ""}<input type="datetime-local" value={opens} disabled={opened} onChange={(e) => setOpens(e.target.value)} /></label>
        <label className="qb-field">Closes<input type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} /></label>
        <p className="qb-muted qb-small">Leave &ldquo;Closes&rdquo; empty to keep the {noun} open until you end it. To close it now, use End {noun} above.</p>
      </>}
      <div><button type="button" className="qb-btn" disabled={busy || !title.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save details"}</button>{saved && <span role="status" className="qb-success" style={{ marginLeft: 12 }}>Saved.</span>}</div>
    </div>
  );
}
