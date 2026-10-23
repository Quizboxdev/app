"use client";

import { useState } from "react";
import { sellerSave, type Seller } from "@/lib/api/marketplace";

// Becoming a seller, and changing where the money goes. Changing payout details sends a verified seller back to "pending" so staff look at them again (the database does this).
const NETWORKS = ["MTN", "Vodafone (Telecel)", "AirtelTigo", "GCB Bank", "Ecobank", "Fidelity Bank", "Absa", "Stanbic", "Zenith Bank", "CalBank", "Access Bank", "Other bank"];
export default function SellerForm({ seller, onSaved }: { seller: Seller | null; onSaved: (s: Seller) => void }) {
  const [f, setF] = useState({ display_name: seller?.display_name ?? "", school: seller?.school_name ?? "", phone: seller?.phone ?? "", method: (seller?.payout_method ?? "mobile_money") as "mobile_money" | "bank", network: seller?.payout_network ?? "MTN", account: "", account_name: seller?.payout_account_name ?? "", accept: !!seller?.terms_accepted });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setSaved(false); };
  const keepingAccount = !!seller && !f.account;

  async function save() {
    setBusy(true); setError(""); setSaved(false);
    try {
      // The account number is never sent back to the browser, so editing the other details needs it typed again only when the destination itself changes.
      if (keepingAccount) throw new Error("Type your account number again to save changes to your details.");
      onSaved(await sellerSave({ display_name: f.display_name, school: f.school, phone: f.phone, method: f.method, network: f.network, account: f.account, account_name: f.account_name, accept_terms: f.accept })); setSaved(true);
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  return (
    <div className="qb-card qb-form" style={{ display: "grid", gap: 12 }}>
      <h3 style={{ margin: 0 }}>{seller ? "Your seller details" : "Become a seller"}</h3>
      <div className="qb-grid cols-2">
        <label className="qb-field">Your name as buyers will see it<input value={f.display_name} maxLength={80} onChange={(e) => set("display_name", e.target.value)} placeholder="e.g. Ama Mensah" /></label>
        <label className="qb-field">Your school (shown on your sets)<input value={f.school} maxLength={120} onChange={(e) => set("school", e.target.value)} placeholder="e.g. Opoku Ware School" /></label>
        <label className="qb-field">Phone number<input inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value.replace(/[^0-9+ ]/g, ""))} placeholder="0244 000 000" /></label>
        <label className="qb-field">Get paid by<select value={f.method} onChange={(e) => set("method", e.target.value as "mobile_money" | "bank")}><option value="mobile_money">Mobile money</option><option value="bank">Bank account</option></select></label>
        <label className="qb-field">{f.method === "bank" ? "Bank" : "Network"}<select value={f.network} onChange={(e) => set("network", e.target.value)}>{NETWORKS.map((n) => <option key={n}>{n}</option>)}</select></label>
        <label className="qb-field">{f.method === "bank" ? "Account number" : "Mobile money number"}{seller && <span className="qb-small qb-muted"> (now {seller.payout_account_masked})</span>}<input inputMode="numeric" value={f.account} onChange={(e) => set("account", e.target.value.replace(/[^0-9 -]/g, ""))} placeholder={seller ? "Type it again to save" : ""} /></label>
        <label className="qb-field" style={{ gridColumn: "1 / -1" }}>Name on the account (must match your own name)<input value={f.account_name} maxLength={80} onChange={(e) => set("account_name", e.target.value)} /></label>
      </div>
      {!seller?.terms_accepted && (
        <fieldset className="qb-card" style={{ margin: 0, display: "grid", gap: 6 }}>
          <legend className="qb-small"><strong>Seller terms</strong></legend>
          <ul className="qb-list qb-small" style={{ margin: 0 }}>
            <li>Every question set is checked by QuizBox before it goes on sale. We may ask you to change it.</li>
            <li>Sets must be your own work or work you have the right to sell. Copied questions lead to removal and a paused account.</li>
            <li>Each sale is shared <strong>60% to you and 40% to QuizBox</strong>. QuizBox pays the payment-gateway fees from its 40%.</li>
            <li>Your share can be requested <strong>7 days after a sale</strong>. If a sale is refunded, your share for it is taken back.</li>
            <li>Payouts are paid by hand to the account above, within 24 hours on working days (Monday to Friday) after you approve the amount.</li>
            <li>Buyers keep a set for 90 days. You may take a set off sale at any time; buyers keep what they already bought.</li>
          </ul>
          <label className="qb-check"><input type="checkbox" checked={f.accept} onChange={(e) => set("accept", e.target.checked)} /> I have read and accept these terms and the QuizBox Terms of Service.</label>
        </fieldset>
      )}
      {error && <p className="qb-error" role="alert">{error}</p>}
      {saved && <p className="qb-ok" role="status">Saved.{!seller ? " We will check your details and tell you when you can sell." : ""}</p>}
      <button className="qb-btn" disabled={busy} onClick={() => void save()} style={{ justifySelf: "start" }}>{busy ? "Saving…" : seller ? "Save my details" : "Apply to sell"}</button>
    </div>
  );
}
