"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, Save, Plus } from "lucide-react";
import { formatOptions, marketAdmin, marketSetup, parseOptions, type MarketRow, type MarketStatus } from "@/lib/api/markets";
type RecordRow = Record<string, any>;

const NEXT: Record<MarketStatus, MarketStatus[]> = { DRAFT: ["CONFIGURING"], CONFIGURING: ["DRAFT", "READY"], READY: ["CONFIGURING", "ACTIVE"], ACTIVE: ["SUSPENDED"], SUSPENDED: ["ACTIVE", "CONFIGURING"] };
type Dashboard = Record<string, number> & { markets: Array<Record<string, string | number | boolean>> };
type ChangeRequest = { id: string; user: string; role: string; from: string | null; to: string; reason: string; created_at: string };
const blank = { id: "", country_code: "", country_iso3: "", country_name: "", name: "", currency_code: "", currency_name: "", timezone: "", locale: "", is_test: false,
  levels: "", grades: "", subjects: "", self_practice: "STRICT_GRADE", sme_currency: "", sponsors_enabled: true, competitions_enabled: true };

// Super Admin market launch workflow. Every rule is enforced by qb_market_admin / market_readiness.
export default function MarketSetup() {
  const [markets, setMarkets] = useState<MarketRow[]>([]), [dashboard, setDashboard] = useState<Dashboard | null>(null), [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [authorities, setAuthorities] = useState<RecordRow[]>([]), [form, setForm] = useState(blank), [curriculum, setCurriculum] = useState({ market_id: "", authority_id: "", code: "", name: "", version: "", effective_from: "", effective_to: "", source_name: "", source_hash: "" });
  const [scope, setScope] = useState(""), [curricula, setCurricula] = useState<RecordRow[]>([]), [sources, setSources] = useState<RecordRow[]>([]), [adminEmail, setAdminEmail] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const [m, d, r] = await Promise.all([marketAdmin<MarketRow[]>("list"), marketAdmin<Dashboard>("dashboard"), marketAdmin<ChangeRequest[]>("change_requests")]);
    setMarkets(m); setDashboard(d); setRequests(r);
    setAuthorities(await marketSetup<RecordRow[]>("authorities"));
    if (scope) { setCurricula(await marketSetup<RecordRow[]>("curricula", { market_id: scope })); setSources(await marketSetup<RecordRow[]>("sources", { market_id: scope })); }
  }, [scope]);
  useEffect(() => { void load().catch((cause) => setError((cause as Error).message)); }, [load]);
  async function perform(work: () => Promise<void>, done: string) { if (busy) return; setBusy(true); setError(""); setNotice(""); try { await work(); setNotice(done); await load(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  const edit = (m: MarketRow) => { const c = m.configuration as Record<string, any>; setForm({ ...blank, id: m.id, country_code: m.country_code, country_name: m.country, name: m.name, currency_code: m.currency, timezone: m.timezone, locale: m.locale, is_test: m.is_test,
    levels: formatOptions(c.education_levels), grades: formatOptions(c.grades), subjects: formatOptions(c.subjects), self_practice: c.grade_policy?.self_practice ?? "STRICT_GRADE", sme_currency: c.sme_currency ?? "", sponsors_enabled: c.sponsors_enabled ?? true, competitions_enabled: c.competitions_enabled ?? true }); };
  function saveMarket(event: FormEvent) {
    event.preventDefault();
    const configuration = { education_levels: parseOptions(form.levels), grades: parseOptions(form.grades), subjects: parseOptions(form.subjects), grade_policy: { self_practice: form.self_practice, teacher_assignment: "TEACHER_OVERRIDE" },
      sme_currency: form.sme_currency || form.currency_code, sponsors_enabled: form.sponsors_enabled, competitions_enabled: form.competitions_enabled };
    void perform(async () => { await marketAdmin("save_market", { ...form, id: form.id || null, configuration }); setForm(blank); }, "Market saved.");
  }
  const field = (key: keyof typeof blank, label: string, extra: Record<string, unknown> = {}) => <label>{label}<input value={String(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...extra}/></label>;
  const area = (key: "levels" | "grades" | "subjects", label: string, hint: string) => <label>{label}<textarea rows={4} placeholder={hint} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}/></label>;

  return <div className="qb-content-ops">
    <div className="qb-page-head"><div><h1>Market setup</h1><p>Launch and govern countries. A market cannot become ACTIVE until its readiness check passes.</p></div>
      <button title="Refresh" aria-label="Refresh markets" disabled={busy} onClick={() => void perform(async () => {}, "")}><RefreshCw size={16}/></button></div>
    {error && <p className="qb-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {dashboard && <section><h2>Platform overview</h2>
      <dl className="qb-content-filters">{["active_markets", "configured_markets", "active_competitions", "attempts", "unresolved_source_items", "unresolved_compensation", "pending_market_changes"].map((k) => <div key={k}><dt>{k.replaceAll("_", " ")}</dt><dd>{dashboard[k]}</dd></div>)}</dl>
      <div className="qb-table-wrap"><table className="qb-table"><thead><tr>{["Market", "Status", "Ready", "Users", "Students", "Teachers", "SMEs", "Sponsors", "Questions", "Approved"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{dashboard.markets.map((m) => <tr key={String(m.market)}><td>{String(m.market)}{m.is_test ? " (test)" : ""}</td><td>{String(m.status)}</td><td>{m.ready ? "Yes" : "No"}</td>{["users", "students", "teachers", "smes", "sponsors", "questions", "approved_questions"].map((k) => <td key={k}>{String(m[k])}</td>)}</tr>)}</tbody></table></div>
    </section>}
    <section><h2>Markets</h2><div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Market</th><th>Country</th><th>Currency / locale</th><th>Status</th><th>Readiness</th><th>Actions</th></tr></thead><tbody>
      {markets.map((m) => <tr key={m.id}><td>{m.name}{m.is_test && " (test, hidden from signup)"}</td><td>{m.country} ({m.country_code})</td><td>{m.currency} · {m.locale} · {m.timezone}</td><td>{m.status}</td>
        <td>{m.readiness.ready ? "Ready" : m.readiness.blockers.map((b) => <div key={b}><small>{b.replaceAll("_", " ")}</small></div>)}<small>SME coverage: {m.readiness.sme_coverage}</small></td>
        <td className="qb-content-filters"><button disabled={busy} onClick={() => edit(m)}>Edit</button>{NEXT[m.status].map((s) => <button key={s} disabled={busy} onClick={() => void perform(async () => { const r = await marketAdmin<{ changed: boolean; blockers: string[] }>("set_status", { market_id: m.id, status: s }); if (!r.changed) throw new Error(`Not ready: ${r.blockers.join(", ")}`); }, `Status changed to ${s}.`)}>Move to {s}</button>)}</td></tr>)}
    </tbody></table></div></section>
    <section><h2>{form.id ? "Edit market" : "New market"}</h2><form className="qb-content-filters" onSubmit={saveMarket}>
      {field("country_code", "Country ISO-2", { required: true, maxLength: 2 })}{!form.id && field("country_iso3", "Country ISO-3", { maxLength: 3 })}{field("country_name", "Country name", { required: !form.id })}
      {field("name", "Market name", { required: true })}{field("currency_code", "Currency (ISO 4217)", { required: true, maxLength: 3 })}{!form.id && field("currency_name", "Currency name (if new)")}
      {field("timezone", "Time zone", { required: true, placeholder: "e.g. Africa/Lagos" })}{field("locale", "Locale", { required: true, placeholder: "e.g. en-NG" })}
      {area("levels", "Education levels", "CODE: Label")}{area("grades", "Grades", "CODE: Label | LEVEL_CODE")}{area("subjects", "Subjects", "CODE: Label")}
      <label>Self-practice grade policy<select value={form.self_practice} onChange={(e) => setForm({ ...form, self_practice: e.target.value })}><option value="STRICT_GRADE">Strict grade</option><option value="OPEN_LEVEL">Open level (explicit)</option></select></label>
      {field("sme_currency", "Default SME currency", { maxLength: 3 })}
      <label><input type="checkbox" checked={form.sponsors_enabled} onChange={(e) => setForm({ ...form, sponsors_enabled: e.target.checked })}/>Sponsors available</label>
      <label><input type="checkbox" checked={form.competitions_enabled} onChange={(e) => setForm({ ...form, competitions_enabled: e.target.checked })}/>Competitions available</label>
      <label><input type="checkbox" checked={form.is_test} onChange={(e) => setForm({ ...form, is_test: e.target.checked })}/>Test market (never shown to real users)</label>
      <button className="qb-btn" disabled={busy}><Save size={16}/>Save market</button>{form.id && <button type="button" onClick={() => setForm(blank)}>Cancel</button>}
    </form><p className="qb-muted">Teacher cross-grade assignments always require an explicit, audited override.</p></section>
    <section><h2>Register a curriculum</h2><p className="qb-muted">New curricula start inactive. Add the authority under <Link href="/admin/markets">Markets › Authorities</Link>, ingest and approve official sources, then activate the curriculum under Curricula by Market.</p>
      <form className="qb-content-filters" onSubmit={(e) => { e.preventDefault(); void perform(async () => { await marketAdmin("save_curriculum", curriculum); }, "Curriculum registered (inactive)."); }}>
        <label>Market<select value={curriculum.market_id} onChange={(e) => setCurriculum({ ...curriculum, market_id: e.target.value })} required><option value="">Select</option>{markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label>Authority<select value={curriculum.authority_id} onChange={(e) => setCurriculum({ ...curriculum, authority_id: e.target.value })} required><option value="">Select</option>{authorities.filter((a) => a.market_id === curriculum.market_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        {(["code", "name", "version", "source_name", "source_hash"] as const).map((k) => <label key={k}>{k.replace("_", " ")}<input value={curriculum[k]} onChange={(e) => setCurriculum({ ...curriculum, [k]: e.target.value })} required/></label>)}
        <label>Effective from<input type="date" value={curriculum.effective_from} onChange={(e) => setCurriculum({ ...curriculum, effective_from: e.target.value })}/></label>
        <label>Effective to<input type="date" value={curriculum.effective_to} onChange={(e) => setCurriculum({ ...curriculum, effective_to: e.target.value })}/></label>
        <button className="qb-btn" disabled={busy}><Plus size={16}/>Register curriculum</button>
      </form></section>
    <section><h2>Curricula, sources and admins</h2>
      <label>Market<select aria-label="Setup market" value={scope} onChange={(e) => setScope(e.target.value)}><option value="">Select market</option>{markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      {scope && <>
        <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Curriculum</th><th>Authority</th><th>Nodes</th><th>Approved sources</th><th>Status</th><th>Action</th></tr></thead><tbody>
          {curricula.map((c) => <tr key={c.curriculum_id}><td>{c.code} · {c.name} ({c.version})</td><td>{c.authority ?? "-"}</td><td>{c.nodes}</td><td>{c.approved_sources}</td><td>{c.active ? "Active" : "Inactive"}</td>
            <td><button disabled={busy} onClick={() => void perform(async () => { await marketSetup(c.active ? "deactivate_curriculum" : "activate_curriculum", { curriculum_id: c.curriculum_id }); }, c.active ? "Curriculum deactivated." : "Curriculum activated.")}>{c.active ? "Deactivate" : "Activate"}</button></td></tr>)}
        </tbody></table></div>
        <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Official source</th><th>Rights</th><th>Extracted text</th><th>Status</th><th>Action</th></tr></thead><tbody>
          {sources.map((d) => <tr key={d.id}><td>{d.title}</td><td>{d.rights_confirmed ? "Confirmed" : "Missing"}</td><td>{d.has_text ? "Yes" : "No"}</td><td>{d.validation_status}</td>
            <td>{d.validation_status !== "approved" && <button disabled={busy} onClick={() => void perform(async () => { await marketSetup("approve_source", { market_id: scope, source_id: d.id }); }, "Source approved.")}>Approve</button>}</td></tr>)}
        </tbody></table></div>
        <form className="qb-content-filters" onSubmit={(e) => { e.preventDefault(); void perform(async () => { await marketSetup("add_market_admin", { market_id: scope, email: adminEmail }); setAdminEmail(""); }, "Market admin added."); }}>
          <label>Market admin email<input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required/></label><button disabled={busy}>Add market admin</button></form>
      </>}
    </section>
    <section><h2>Country change requests</h2>{!requests.length && <p>No pending requests.</p>}
      {requests.map((r) => <div className="qb-row" key={r.id}><span>{r.user} ({r.role}): {r.from ?? "-"} → {r.to} · {r.reason}</span>
        {(["APPROVED", "REJECTED"] as const).map((d) => <button key={d} disabled={busy} onClick={() => void perform(async () => { await marketAdmin("decide_change", { request_id: r.id, decision: d }); }, `Request ${d.toLowerCase()}.`)}>{d === "APPROVED" ? "Approve" : "Reject"}</button>)}</div>)}
    </section>
  </div>;
}
