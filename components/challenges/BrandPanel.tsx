"use client";

import { useEffect, useState } from "react";
import { setBrand } from "@/lib/api/challenges";
import type { Brand } from "@/lib/challenges/types";
import LogoPicker from "@/components/challenges/LogoPicker";
import SpotlightCard from "@/components/challenges/SpotlightCard";

// The organiser's look for the public page and the player: a name, a one-line tagline, a welcome message and one accent colour. Colours are checked so text stays readable.
export default function BrandPanel({ id, brand, onChanged, onError }: { id: string; brand: Brand; onChanged: () => void; onError: (m: string) => void }) {
  const [b, setB] = useState<Brand>(brand), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  useEffect(() => { setB(brand); }, [brand]);
  const accent = /^#[0-9a-f]{6}$/i.test(b.accent ?? "") ? b.accent : undefined;
  async function save() {
    setBusy(true); onError(""); setSaved(false);
    try { await setBrand(id, b); setSaved(true); onChanged(); } catch (e: any) { onError(e.message); }
    setBusy(false);
  }
  return (
    <div className="qb-card qb-form">
      <h2>Look and feel</h2>
      <p className="qb-muted">Shown on the public page of your challenge and while people play.</p>
      <LogoPicker campaignId={id} value={b.logo} onChange={(logo) => setB((x) => ({ ...x, logo }))} onError={onError} />
      <div className="qb-grid cols-3">
        <label className="qb-field">Organiser name<input maxLength={60} value={b.organiser_name ?? ""} onChange={(e) => setB({ ...b, organiser_name: e.target.value })} placeholder="Accra Academy" /></label>
        <label className="qb-field">Tagline<input maxLength={120} value={b.tagline ?? ""} onChange={(e) => setB({ ...b, tagline: e.target.value })} placeholder="Think fast, think smart" /></label>
        <label className="qb-field">Accent colour<input type="color" value={accent ?? "#1a7f5a"} onChange={(e) => setB({ ...b, accent: e.target.value })} /></label>
      </div>
      <label className="qb-field">Welcome message<textarea maxLength={300} rows={3} value={b.welcome ?? ""} onChange={(e) => setB({ ...b, welcome: e.target.value })} /></label>
      <div aria-label="Preview"><SpotlightCard title="Your quiz headline" summary={b.tagline || b.welcome} brand={b} sponsored={false} /></div>
      <button className="qb-btn" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save look and feel"}</button>
      {saved && <p role="status">Saved.</p>}
    </div>
  );
}
