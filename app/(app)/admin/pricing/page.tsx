"use client";

import { useCallback, useEffect, useState } from "react";
import { listPricesAdmin, savePrice } from "@/lib/api/pricing";
import { AUDIENCE_LABEL, fromMinor, PERIOD_LABEL, toMinor, type PriceAdminRow, type PriceAudience, type PricePeriod } from "@/lib/pricing/format";
import PricingCards from "@/components/pricing/PricingCards";
import ExportLink from "@/components/admin/ExportLink";

// Prices and payment links. One card per thing QuizBox sells. Type the price in cedis and paste the payment link from your payment gateway (it must start with https://); the pricing page and
// the in-app cards update at once. Leave the price empty to show "Price to be announced"; a price of 0 shows "Free". Cards are switched off, never deleted.
const AUDIENCES = Object.keys(AUDIENCE_LABEL) as PriceAudience[], PERIODS = Object.keys(PERIOD_LABEL) as PricePeriod[];
const toLocal = (iso?: string | null) => { if (!iso) return ""; const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
type Draft = { name: string; audience: PriceAudience; period: PricePeriod; kind: string; description: string; price: string; url: string; includes: string; highlight: boolean; active: boolean; sort: number; starts: string; ends: string };
const toDraft = (r: PriceAdminRow): Draft => ({ name: r.name, audience: r.audience, period: r.period, kind: r.kind, description: r.description, price: fromMinor(r.price_minor), url: r.checkout_url ?? "", includes: r.includes.join("\n"), highlight: r.highlight, active: r.active, sort: r.sort_order, starts: toLocal(r.starts_at), ends: toLocal(r.ends_at) });
const blank: Draft = { name: "", audience: "sponsor", period: "campaign", kind: "campaign", description: "", price: "", url: "", includes: "", highlight: false, active: false, sort: 100, starts: "", ends: "" };

function Editor({ code, initial, isNew, onSaved, onError }: { code: string; initial: Draft; isNew?: boolean; onSaved: () => void; onError: (m: string) => void }) {
  const [d, setD] = useState(initial), [busy, setBusy] = useState(false), [ok, setOk] = useState(false), [newCode, setNewCode] = useState("");
  useEffect(() => setD(initial), [initial]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD((x) => ({ ...x, [k]: v })); setOk(false); };
  async function save() {
    setBusy(true); onError(""); setOk(false);
    try {
      const target = isNew ? (newCode.trim() || slug(d.name)) : code;
      if (isNew && !/^[a-z0-9_]{3,60}$/.test(target)) throw new Error("Give it a name first (at least 3 letters).");
      await savePrice(target, { name: d.name.trim(), audience: d.audience, period: d.period, kind: d.kind, description: d.description.trim(), price_minor: toMinor(d.price), checkout_url: d.url.trim() || null,
        includes: d.includes.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 12), highlight: d.highlight, active: d.active, sort_order: d.sort, starts_at: d.starts ? new Date(d.starts).toISOString() : null, ends_at: d.ends ? new Date(d.ends).toISOString() : null });
      setOk(true); if (isNew) setD(blank); onSaved();
    } catch (e: any) { onError(e.message); }
    setBusy(false);
  }
  return (
    <div className="qb-card qb-form">
      <h3>{isNew ? "Add a price" : d.name || code}{!isNew && <span className="qb-muted qb-small"> · {code}</span>}</h3>
      <div className="qb-grid cols-3">
        <label className="qb-field">Name<input value={d.name} maxLength={80} onChange={(e) => set("name", e.target.value)} /></label>
        <label className="qb-field">For<select value={d.audience} onChange={(e) => set("audience", e.target.value as PriceAudience)}>{AUDIENCES.map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}</select></label>
        <label className="qb-field">Charged<select value={d.period} onChange={(e) => set("period", e.target.value as PricePeriod)}>{PERIODS.map((p) => <option key={p} value={p}>{p === "free" ? "Free (no charge)" : PERIOD_LABEL[p]}</option>)}</select></label>
        <label className="qb-field">Price in cedis (empty = to be announced, 0 = free)<input inputMode="decimal" value={d.price} onChange={(e) => set("price", e.target.value)} placeholder="e.g. 25" /></label>
        <label className="qb-field" style={{ gridColumn: "span 2" }}>Payment link for invoice or hand-confirmed sales only (https://…). Card and mobile-money plans use our own checkout, so leave this empty for them<input type="url" value={d.url} onChange={(e) => set("url", e.target.value)} placeholder="https://paystack.com/pay/…" /></label>
      </div>
      <label className="qb-field">One line about it<input value={d.description} maxLength={300} onChange={(e) => set("description", e.target.value)} /></label>
      <label className="qb-field">What is included (one per line, up to 12)<textarea rows={4} value={d.includes} onChange={(e) => set("includes", e.target.value)} /></label>
      <div className="qb-grid cols-3">
        <label className="qb-check"><input type="checkbox" checked={d.active} onChange={(e) => set("active", e.target.checked)} /> Show on the pricing page</label>
        <label className="qb-check"><input type="checkbox" checked={d.highlight} onChange={(e) => set("highlight", e.target.checked)} /> Mark as best value</label>
        <label className="qb-field">Order<input type="number" min={0} max={9999} value={d.sort} onChange={(e) => set("sort", Number(e.target.value) || 0)} /></label>
        <label className="qb-field">On sale from (optional)<input type="datetime-local" value={d.starts} onChange={(e) => set("starts", e.target.value)} /></label>
        <label className="qb-field">On sale until (optional)<input type="datetime-local" value={d.ends} onChange={(e) => set("ends", e.target.value)} /></label>
        {isNew && <label className="qb-field">Short code (optional)<input value={newCode} onChange={(e) => setNewCode(e.target.value.toLowerCase())} placeholder={slug(d.name) || "e.g. sponsor_gold"} /></label>}
      </div>
      <div><button className="qb-btn" disabled={busy || d.name.trim().length < 2} onClick={() => void save()}>{busy ? "Saving…" : isNew ? "Add price" : "Save"}</button>{ok && <span role="status"> Saved.</span>}</div>
    </div>
  );
}

export default function AdminPricingPage() {
  const [rows, setRows] = useState<PriceAdminRow[] | null>(null), [error, setError] = useState("");
  const load = useCallback(() => listPricesAdmin().then(setRows).catch((e) => { setError(e.message); setRows([]); }), []);
  useEffect(() => { void load(); }, [load]);
  const onError = useCallback((m: string) => setError(m), []);
  const live = (rows ?? []).filter((r) => r.active);
  return (
    <>
      <div className="qb-page-head"><div><h1>Prices and payment links</h1><p>What QuizBox sells, for whom, and where buyers pay. Type the price in cedis and paste the link from your payment gateway. Changes appear on the pricing page at once.</p></div><ExportLink dataset="price_list" /></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      <div className="qb-card" role="note"><strong>How payment works today.</strong> A card with a price and a link sends the buyer to that link. For learner plans you can leave the link empty and the existing secure checkout is used, which records who paid. A link opens the gateway but cannot tell QuizBox who paid, so for those sales activate the buyer yourself under Access and Subscriptions.</div>
      <Editor code="" initial={blank} isNew onSaved={() => void load()} onError={onError} />
      {rows === null ? <div className="qb-card" role="status">Loading…</div> : rows.map((r) => <Editor key={r.code} code={r.code} initial={toDraft(r)} onSaved={() => void load()} onError={onError} />)}
      <div className="qb-card"><h2>Preview: what visitors see</h2><p className="qb-muted">Only cards switched on and inside their sale dates. Payment links show only when a price is set.</p>
        <PricingCards rows={live.map((r) => ({ ...r, checkout_url: r.price_minor && r.price_minor > 0 ? r.checkout_url : null }))} /></div>
    </>
  );
}
