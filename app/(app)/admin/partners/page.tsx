"use client";

import { useCallback, useEffect, useState } from "react";
import { when } from "@/lib/api/marketplace";
import * as P from "@/lib/api/partners";
import type { Detail, EventRow, AuditRow, Overview, SeatRow } from "@/lib/api/partners";

// Partner Integrations: schools and companies that buy licences outside QuizBox. Super admins only (the database checks every call). Nothing here shows real figures that are not in the database,
// and no secret is shown after it is first issued. The gateway stays off until the owner switches it on.
const PILL: Record<string, string> = { verified: "success", active: "success", approved: "success", processed: "success", pending_approval: "warning", pending_verification: "warning", draft: "neutral", suspended: "warning", failed: "warning", revoked: "danger", cancelled: "danger", expired: "danger", dead: "danger" };
const pill = (s: string) => <span className={`qb-pill ${PILL[s] ?? "neutral"}`}>{s.replace(/_/g, " ")}</span>;
type Tab = "contracts" | "seats" | "signin" | "access" | "events" | "audit";
const TABS: [Tab, string][] = [["contracts", "Contracts"], ["seats", "Seats"], ["signin", "Sign-in setup"], ["access", "Keys and events"], ["events", "Delivery log"], ["audit", "Audit"]];

export default function AdminPartnersPage() {
  const [ov, setOv] = useState<Overview | null>(null), [error, setError] = useState(""), [sel, setSel] = useState<string | null>(null);
  const load = useCallback(async () => { try { setOv(await P.overview()); setError(""); } catch (e: any) { setError(e.message); } }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <>
      <div className="qb-page-head"><div><h1>Partner Integrations</h1><p>Schools and companies that buy licence bundles outside QuizBox and give people access through their own sign-in. QuizBox staff verify the partner and approve every contract.</p></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {ov && <GatewaySwitch enabled={ov.enabled} onChange={load} />}
      {ov && (sel ? <PartnerDetail id={sel} back={() => { setSel(null); void load(); }} /> : <Directory ov={ov} open={setSel} onChange={load} />)}
    </>
  );
}

function GatewaySwitch({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  const [sure, setSure] = useState(false), [error, setError] = useState("");
  async function flip(on: boolean) { try { await P.gatewaySwitch(on); setSure(false); onChange(); } catch (e: any) { setError(e.message); } }
  return (
    <div className="qb-card" role="status" style={{ display: "grid", gap: 8, marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className={`qb-pill ${enabled ? "success" : "neutral"}`}>{enabled ? "Gateway is ON" : "Gateway is OFF"}</span>
        <span className="qb-small">{enabled ? "Licences grant access, partners can sign in and use their keys." : "Nothing a partner does has any effect, and licences grant no access."}</span>
      </div>
      {!enabled ? (<>
        <label className="qb-check"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> A partner, a contract and a test sign-in have been checked on Preview, and I want the gateway open.</label>
        <button className="qb-btn" style={{ justifySelf: "start" }} disabled={!sure} onClick={() => void flip(true)}>Switch the gateway on</button>
      </>) : <button className="qb-btn secondary" style={{ justifySelf: "start" }} onClick={() => void flip(false)}>Switch the gateway off</button>}
      {error && <p className="qb-error" role="alert">{error}</p>}
    </div>
  );
}

function Directory({ ov, open, onChange }: { ov: Overview; open: (id: string) => void; onChange: () => void }) {
  const [name, setName] = useState(""), [kind, setKind] = useState("school"), [country, setCountry] = useState("GH"), [error, setError] = useState("");
  async function add() { try { const r = await P.partnerSave({ name, kind, country }); setName(""); onChange(); open(r.id); } catch (e: any) { setError(e.message); } }
  return (
    <>
      <div className="qb-card" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginBottom: 16 }}>
        <label className="qb-field" style={{ flex: "2 1 220px" }}>New partner name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></label>
        <label className="qb-field">Type<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="school">School</option><option value="company">Company</option><option value="other">Other</option></select></label>
        <label className="qb-field" style={{ maxWidth: 90 }}>Country<input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} /></label>
        <button className="qb-btn" disabled={name.trim().length < 2} onClick={() => void add()}>Add partner</button>
        {error && <p className="qb-error" role="alert" style={{ flexBasis: "100%" }}>{error}</p>}
      </div>
      {ov.partners.length === 0 ? <div className="qb-empty">No partners yet. Add the first one above, then verify it before creating a contract.</div> : (
        <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Partner</th><th>Type</th><th>Status</th><th>Sign-in</th><th>Contracts</th><th>Seats</th><th>Failed events</th><th /></tr></thead><tbody>
          {ov.partners.map((p) => (
            <tr key={p.id}><td><strong>{p.name}</strong><div className="qb-small qb-muted">{p.country ?? ""}</div></td><td>{p.kind}</td><td>{pill(p.status)}</td><td>{p.sso ? pill(p.sso) : <span className="qb-muted">not set</span>}</td>
              <td>{p.contracts.length}</td><td>{p.contracts.reduce((n, c) => n + c.allocated, 0)} / {p.contracts.filter((c) => c.live).reduce((n, c) => n + c.max_seats, 0)} live</td><td>{p.dead_events || ""}</td>
              <td><button className="qb-btn secondary" onClick={() => open(p.id)}>Open</button></td></tr>))}
        </tbody></table></div>)}
    </>
  );
}

function PartnerDetail({ id, back }: { id: string; back: () => void }) {
  const [d, setD] = useState<Detail | null>(null), [tab, setTab] = useState<Tab>("contracts"), [error, setError] = useState("");
  const load = useCallback(async () => { try { setD(await P.detail(id)); setError(""); } catch (e: any) { setError(e.message); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <div className="qb-card">{error || "Loading…"}</div>;
  return (
    <>
      <p><button className="qb-btn ghost" onClick={back}>← All partners</button></p>
      <div className="qb-card" style={{ display: "grid", gap: 8, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><h2 style={{ margin: 0 }}>{d.partner.name}</h2>{pill(d.partner.status)}<span className="qb-muted qb-small">{d.partner.kind} · {d.partner.country_code ?? "no country"}</span></div>
        <StatusActions d={d} onChange={load} />
        {error && <p className="qb-error" role="alert">{error}</p>}
      </div>
      <div role="tablist" aria-label="Partner sections" style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {TABS.map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "qb-btn" : "qb-btn secondary"} onClick={() => setTab(t)}>{l}</button>)}
      </div>
      {tab === "contracts" && <Contracts d={d} onChange={load} />}
      {tab === "seats" && <Seats d={d} />}
      {tab === "signin" && <SignIn d={d} onChange={load} />}
      {tab === "access" && <Access d={d} onChange={load} />}
      {tab === "events" && <Events id={id} />}
      {tab === "audit" && <Audit id={id} />}
    </>
  );
}

function StatusActions({ d, onChange }: { d: Detail; onChange: () => void }) {
  const [note, setNote] = useState(""), [error, setError] = useState("");
  async function set(s: string) { try { await P.partnerStatus(d.partner.id, s, note); setNote(""); setError(""); onChange(); } catch (e: any) { setError(e.message); } }
  const st = d.partner.status;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input aria-label="Reason or evidence checked" placeholder="Evidence checked, or reason (required)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: "2 1 280px" }} />
      {st !== "verified" && st !== "revoked" && <button className="qb-btn" disabled={!note.trim()} onClick={() => void set("verified")}>Verify partner</button>}
      {st === "verified" && <button className="qb-btn secondary" disabled={!note.trim()} onClick={() => void set("suspended")}>Suspend</button>}
      {st !== "revoked" && <button className="qb-btn secondary" disabled={!note.trim()} onClick={() => { if (confirm("Revoking ends all keys and sign-in for this partner for good. Continue?")) void set("revoked"); }}>Revoke</button>}
      {error && <span className="qb-error" role="alert">{error}</span>}
    </div>
  );
}

function Contracts({ d, onChange }: { d: Detail; onChange: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ pkg: "", staff: false, start: today, end: "", max: 10, ref: "" }), [note, setNote] = useState<Record<string, string>>({}), [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); setError(""); onChange(); } catch (e: any) { setError(e.message); } };
  return (
    <>
      {error && <div className="qb-card qb-error" role="alert" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="qb-card" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginBottom: 16 }}>
        <label className="qb-field">Package<input value={f.pkg} onChange={(e) => setF({ ...f, pkg: e.target.value })} placeholder="e.g. school-annual" /></label>
        <label className="qb-field">Starts<input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
        <label className="qb-field">Ends<input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label>
        <label className="qb-field" style={{ maxWidth: 110 }}>Seats<input type="number" min={1} value={f.max} onChange={(e) => setF({ ...f, max: Number(e.target.value) })} /></label>
        <label className="qb-field">External invoice reference<input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></label>
        <label className="qb-check"><input type="checkbox" checked={f.staff} onChange={(e) => setF({ ...f, staff: e.target.checked })} /> Includes staff (teacher) seats</label>
        <button className="qb-btn" disabled={!f.pkg.trim() || !f.end || f.max < 1} onClick={() => void run(() => P.contractSave({ partner: d.partner.id, pkg: f.pkg, caps: f.staff ? ["practice", "staff"] : ["practice"], country: d.partner.country_code ?? "", start: f.start, end: f.end, max: f.max, ref: f.ref }))}>Create draft contract</button>
      </div>
      {d.contracts.length === 0 ? <div className="qb-empty">No contracts yet.</div> : d.contracts.map((c) => (
        <div key={c.id} className="qb-card" style={{ display: "grid", gap: 8, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><strong>{c.package}</strong>{pill(c.status)}{c.live && <span className="qb-pill success">in force now</span>}<span className="qb-small qb-muted">{c.starts_on} to {c.expires_on}</span></div>
          <div className="qb-small">Seats in use: {c.learner_seats} learner{c.capabilities.includes("staff") ? ` + ${c.staff_seats} staff` : ""} of {c.max_seats} · Invoice: {c.billing_ref ?? "not set"} · Reconciliation: {c.reconciliation}{c.approval_note ? ` · Note: ${c.approval_note}` : ""}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input aria-label="Note" placeholder="Note (required for approve, suspend, cancel, amend)" value={note[c.id] ?? ""} onChange={(e) => setNote({ ...note, [c.id]: e.target.value })} style={{ flex: "2 1 260px" }} />
            {c.status === "draft" && <button className="qb-btn" onClick={() => void run(() => P.contractSubmit(c.id))}>Submit for approval</button>}
            {c.status === "pending_approval" && <button className="qb-btn" disabled={!note[c.id]?.trim()} onClick={() => void run(() => P.contractApprove(c.id, note[c.id]))}>Approve (invoice checked)</button>}
            {c.status === "active" && <button className="qb-btn secondary" disabled={!note[c.id]?.trim()} onClick={() => void run(() => P.contractStatus(c.id, "suspended", note[c.id]))}>Suspend</button>}
            {c.status === "suspended" && <button className="qb-btn secondary" disabled={!note[c.id]?.trim()} onClick={() => void run(() => P.contractStatus(c.id, "active", note[c.id]))}>Reinstate</button>}
            {["draft", "pending_approval", "active", "suspended"].includes(c.status) && <button className="qb-btn secondary" disabled={!note[c.id]?.trim()} onClick={() => { if (confirm("Cancel this contract? Access ends now; accounts and history stay.")) void run(() => P.contractStatus(c.id, "cancelled", note[c.id])); }}>Cancel</button>}
            {(c.status === "active" || c.status === "suspended") && <button className="qb-btn ghost" onClick={() => { const m = Number(prompt("New total seats", String(c.max_seats))), e = prompt("New end date (YYYY-MM-DD)", c.expires_on); if (m && e && note[c.id]?.trim()) void run(() => P.contractAmend(c.id, m, e, c.billing_ref ?? "", note[c.id])); else setError("Enter seats, a date and a note to amend."); }}>Amend</button>}
            <select aria-label="Reconciliation" value={c.reconciliation} onChange={(e) => void run(() => P.contractReconcile(c.id, e.target.value))}><option value="unreconciled">unreconciled</option><option value="reconciled">reconciled</option><option value="disputed">disputed</option></select>
          </div>
        </div>))}
    </>
  );
}

function Seats({ d }: { d: Detail }) {
  const [cid, setCid] = useState(d.contracts[0]?.id ?? ""), [rows, setRows] = useState<SeatRow[] | null>(null), [error, setError] = useState("");
  useEffect(() => { if (cid) P.seats(cid).then(setRows).catch((e) => setError(e.message)); }, [cid]);
  if (!d.contracts.length) return <div className="qb-empty">Create a contract first.</div>;
  return (
    <>
      <label className="qb-field" style={{ maxWidth: 360 }}>Contract<select value={cid} onChange={(e) => setCid(e.target.value)}>{d.contracts.map((c) => <option key={c.id} value={c.id}>{c.package} ({c.status})</option>)}</select></label>
      {error && <p className="qb-error" role="alert">{error}</p>}
      {rows && (rows.length === 0 ? <div className="qb-empty">No seats allocated yet. The partner allocates seats through its keys or events; only references are shown here, never names.</div> : (
        <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Partner reference</th><th>Kind</th><th>Status</th><th>Has signed in</th><th>Allocated</th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.external_ref + r.allocated_at}><td>{r.external_ref}</td><td>{r.kind}</td><td>{pill(r.status)}</td><td>{r.linked ? "yes" : "not yet"}</td><td>{when(r.allocated_at)}</td></tr>)}
        </tbody></table></div>))}
    </>
  );
}

function SignIn({ d, onChange }: { d: Detail; onChange: () => void }) {
  const i = d.identity;
  const [f, setF] = useState({ issuer: i?.issuer ?? "", audience: i?.audience ?? "", jwks: i?.jwks_uri ?? "", auth: i?.authorization_endpoint ?? "", token: i?.token_endpoint ?? "", domains: (i?.allowed_domains ?? []).join(", "), auto: i?.auto_provision ?? false, secret: "", slug: d.partner.slug ?? "" });
  const [msg, setMsg] = useState(""), [error, setError] = useState("");
  const origin = typeof window !== "undefined" ? window.location.origin : "https://www.quizbox.io";
  async function save(status: string) {
    try {
      await P.slugSet(d.partner.id, f.slug);
      await P.identitySave(d.partner.id, { issuer: f.issuer, audience: f.audience, jwks: f.jwks, domains: f.domains.split(",").map((s) => s.trim()).filter(Boolean), autoProvision: f.auto, status });
      await P.secretAction({ kind: "oidc", partner_id: d.partner.id, authorization_endpoint: f.auth, token_endpoint: f.token, client_secret: f.secret || undefined }, d.partner.id);
      setF({ ...f, secret: "" }); setError(""); setMsg(status === "active" ? "Saved and active." : "Saved as draft."); onChange();
    } catch (e: any) { setMsg(""); setError(e.message); }
  }
  return (
    <div className="qb-card" style={{ display: "grid", gap: 10 }}>
      <p className="qb-small qb-muted" style={{ margin: 0 }}>Step 1: give the partner these two values. Step 2: enter what the partner gives you. Step 3: save as active, then test with a real sign-in on Preview.</p>
      <div className="qb-small"><strong>Redirect address to register with the partner:</strong> <code>{origin}/api/partner/v1/sso/callback</code></div>
      <div className="qb-small"><strong>Sign-in page for the partner&apos;s people:</strong> <code>{origin}/partner/{f.slug || "your-address-name"}</code></div>
      <label className="qb-field">Address name (3-40 letters, numbers, dashes)<input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} /></label>
      <label className="qb-field">Issuer (https://…)<input value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} /></label>
      <label className="qb-field">Client ID<input value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} /></label>
      <label className="qb-field">Authorization address<input value={f.auth} onChange={(e) => setF({ ...f, auth: e.target.value })} /></label>
      <label className="qb-field">Token address<input value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} /></label>
      <label className="qb-field">Signing keys address (JWKS)<input value={f.jwks} onChange={(e) => setF({ ...f, jwks: e.target.value })} /></label>
      <label className="qb-field">Client secret {i?.has_client_secret ? "(one is saved; leave empty to keep it)" : "(optional)"}<input type="password" autoComplete="new-password" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} /></label>
      <label className="qb-field">Partner e-mail domains (comma separated; public mail domains are refused)<input value={f.domains} onChange={(e) => setF({ ...f, domains: e.target.value })} placeholder="school.edu.gh" /></label>
      <label className="qb-check"><input type="checkbox" checked={f.auto} onChange={(e) => setF({ ...f, auto: e.target.checked })} /> Create a learner account on first sign-in (needs a verified address in the domains above and a grade from the partner). Staff roles are never created this way.</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="qb-btn secondary" onClick={() => void save("draft")}>Save as draft</button><button className="qb-btn" disabled={!f.issuer || !f.audience || !f.auth || !f.token || !f.jwks || !f.slug} onClick={() => void save("active")}>Save and activate</button></div>
      {i && <p className="qb-small">Current state: {pill(i.status)} {i.has_client_secret ? "· client secret stored" : ""}</p>}
      {msg && <p role="status" className="qb-small">{msg}</p>}{error && <p className="qb-error" role="alert">{error}</p>}
    </div>
  );
}

function Access({ d, onChange }: { d: Detail; onChange: () => void }) {
  const [scopes, setScopes] = useState<string[]>(["licence:read", "seats:read", "seats:write", "health:read"]), [days, setDays] = useState(90), [shown, setShown] = useState<{ label: string; secret: string } | null>(null), [error, setError] = useState("");
  const run = async (fn: () => Promise<{ secret?: string } | unknown>, label: string) => { try { const r: any = await fn(); if (r?.secret) setShown({ label, secret: r.secret }); setError(""); onChange(); } catch (e: any) { setError(e.message); } };
  return (
    <>
      {shown && <div className="qb-card" role="alert" style={{ borderColor: "var(--amber, #b45309)", marginBottom: 12 }}><strong>{shown.label}: copy it now. It is never shown again.</strong><div><code style={{ wordBreak: "break-all" }}>{shown.secret}</code></div><button className="qb-btn secondary" onClick={() => setShown(null)}>I have saved it</button></div>}
      {error && <div className="qb-card qb-error" role="alert" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="qb-card" style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>API keys</h3>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{P.SCOPES.map((s) => <label key={s} className="qb-check"><input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} /> {s}</label>)}</div>
        <label className="qb-field" style={{ maxWidth: 160 }}>Valid for (days)<input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
        <button className="qb-btn" style={{ justifySelf: "start" }} disabled={!scopes.length || d.partner.status !== "verified"} onClick={() => void run(() => P.credentialIssue(d.partner.id, scopes, days), "New API key")}>Issue a key</button>
        {d.partner.status !== "verified" && <p className="qb-small qb-muted">Verify the partner first.</p>}
        {d.credentials.length > 0 && <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Key</th><th>Scopes</th><th>Status</th><th>Expires</th><th>Last used</th><th /></tr></thead><tbody>
          {d.credentials.map((k) => <tr key={k.id}><td><code>{k.prefix}…</code></td><td className="qb-small">{k.scopes.join(", ")}</td><td>{pill(k.status)}</td><td>{when(k.expires_at)}</td><td>{k.last_used_at ? when(k.last_used_at) : "never"}</td>
            <td>{k.status === "active" && <><button className="qb-btn secondary" onClick={() => void run(() => P.credentialRotate(k.id), "Replacement API key (the old one works for 24 more hours)")}>Rotate</button> <button className="qb-btn ghost" onClick={() => void run(() => P.credentialRevoke(k.id), "")}>Revoke</button></>}</td></tr>)}
        </tbody></table></div>}
      </div>
      <div className="qb-card" style={{ display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Event signing secret</h3>
        <p className="qb-small qb-muted" style={{ margin: 0 }}>{d.webhook_secret ? `Active since ${when(d.webhook_secret.created_at)}. Rotating keeps the old one valid for 24 hours.` : "No secret yet. The partner signs its events with this secret."}</p>
        <button className="qb-btn secondary" style={{ justifySelf: "start" }} disabled={d.partner.status !== "verified"} onClick={() => void run(() => P.secretAction({ kind: "webhook" }, d.partner.id), "Event signing secret")}>{d.webhook_secret ? "Rotate secret" : "Create secret"}</button>
      </div>
    </>
  );
}

function Events({ id }: { id: string }) {
  const [rows, setRows] = useState<EventRow[] | null>(null), [status, setStatus] = useState(""), [error, setError] = useState("");
  const load = useCallback(() => { P.events(id, status || undefined).then(setRows).catch((e) => setError(e.message)); }, [id, status]);
  useEffect(load, [load]);
  return (
    <>
      <label className="qb-field" style={{ maxWidth: 220 }}>Show<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="processed">Processed</option><option value="failed">Failed</option><option value="dead">Dead letters</option></select></label>
      {error && <p className="qb-error" role="alert">{error}</p>}
      {rows && (rows.length === 0 ? <div className="qb-empty">No events.</div> : <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>When</th><th>Event</th><th>Type</th><th>Status</th><th>Tries</th><th>Reason</th><th /></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id}><td>{when(r.received_at)}</td><td className="qb-small">{r.event_id}</td><td className="qb-small">{r.type}</td><td>{pill(r.status)}</td><td>{r.attempts}</td><td className="qb-small">{r.error_code ?? ""}</td>
          <td>{(r.status === "failed" || r.status === "dead") && <button className="qb-btn secondary" onClick={() => void P.eventRequeue(r.id).then(load).catch((e) => setError(e.message))}>Allow retry</button>}</td></tr>)}
      </tbody></table></div>)}
    </>
  );
}

function Audit({ id }: { id: string }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null), [error, setError] = useState("");
  useEffect(() => { P.audit(id).then(setRows).catch((e) => setError(e.message)); }, [id]);
  return (<>{error && <p className="qb-error" role="alert">{error}</p>}{rows && (rows.length === 0 ? <div className="qb-empty">Nothing recorded yet.</div> : <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Action</th><th>Detail</th></tr></thead><tbody>{rows.map((r, n) => <tr key={n}><td>{r.action}</td><td className="qb-small">{Object.entries(r.details).filter(([k]) => k !== "partner_id").map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}</td></tr>)}</tbody></table></div>)}</>);
}
