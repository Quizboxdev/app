"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw, Save } from "lucide-react";
import { formatOptions, marketAdmin, marketSetup, parseOptions, type MarketRow, type MarketStatus } from "@/lib/api/markets";
import { humanize } from "@/lib/format";
import { Kpi, Panel, RankedBars, Segmented, SERIES, num } from "@/components/admin/DataViz";
type RecordRow = Record<string, any>;

const STAGES: MarketStatus[] = ["DRAFT", "CONFIGURING", "READY", "ACTIVE", "SUSPENDED"];
const NEXT: Record<MarketStatus, MarketStatus[]> = { DRAFT: ["CONFIGURING"], CONFIGURING: ["DRAFT", "READY"], READY: ["CONFIGURING", "ACTIVE"], ACTIVE: ["SUSPENDED"], SUSPENDED: ["ACTIVE", "CONFIGURING"] };
const STAGE_TONE: Record<MarketStatus, string> = { DRAFT: "", CONFIGURING: "warn", READY: "private", ACTIVE: "ok", SUSPENDED: "bad" };
type DashMarket = { market: string; status: string; ready: boolean; is_test: boolean; users: number; students: number; teachers: number; smes: number; sponsors: number; questions: number; approved_questions: number };
type Dashboard = Record<string, number> & { markets: DashMarket[] };
type ChangeRequest = { id: string; user: string; role: string; from: string | null; to: string; reason: string; created_at: string };
type Tab = "markets" | "curricula" | "requests" | "market" | "curriculum";
// Labels, examples and formats for "Register a curriculum" (examples are the Ghana curricula already in use).
const CURRICULUM_FIELDS: Array<{ key: "code" | "name" | "version" | "source_name" | "source_hash"; label: string; placeholder: string; hint: string; pattern?: string }> = [
  { key: "code", label: "Curriculum code", placeholder: "e.g. GH-SBC-2019", hint: "Unique short code: country, curriculum abbreviation and year, in capitals with hyphens.", pattern: "[A-Z0-9][A-Z0-9-]{2,39}" },
  { key: "name", label: "Curriculum name", placeholder: "e.g. Ghana Standards-Based Curriculum (Primary)", hint: "Full official name as published by the authority." },
  { key: "version", label: "Version", placeholder: "e.g. 2019", hint: "Edition or year printed on the official document." },
  { key: "source_name", label: "Source document", placeholder: "e.g. NaCCA Standards-Based Curriculum B4-B6", hint: "Title of the official document this curriculum is taken from." },
  { key: "source_hash", label: "Source SHA-256", placeholder: "64 hex characters", hint: "SHA-256 fingerprint of the official PDF: exactly 64 characters, 0-9 and a-f.", pattern: "[0-9a-fA-F]{64}" },
];
const blank = { id: "", country_code: "", country_iso3: "", country_name: "", name: "", currency_code: "", currency_name: "", timezone: "", locale: "", is_test: false,
  levels: "", grades: "", subjects: "", self_practice: "STRICT_GRADE", sme_currency: "", sponsors_enabled: true, competitions_enabled: true };
const blankCurriculum = { market_id: "", authority_id: "", code: "", name: "", version: "", effective_from: "", effective_to: "", source_name: "", source_hash: "" };

// Super Admin market launch workflow. Every rule is enforced by qb_market_admin / market_readiness; this screen only asks and shows.
// Figures and charts come from the same dashboard call as before (no new database function): launch stage, people and question bank by market, and what is blocking launch.
export default function MarketSetup() {
  const [markets, setMarkets] = useState<MarketRow[]>([]), [dashboard, setDashboard] = useState<Dashboard | null>(null), [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [authorities, setAuthorities] = useState<RecordRow[]>([]), [form, setForm] = useState(blank), [curriculum, setCurriculum] = useState(blankCurriculum);
  const [scope, setScope] = useState(""), [curricula, setCurricula] = useState<RecordRow[]>([]), [sources, setSources] = useState<RecordRow[]>([]), [adminEmail, setAdminEmail] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("markets"), [stage, setStage] = useState<"" | MarketStatus>(""), [ready, setReady] = useState<"" | "yes" | "no">(""), [showTest, setShowTest] = useState(true), [search, setSearch] = useState("");

  const load = useCallback(async () => {
    const [m, d, r] = await Promise.all([marketAdmin<MarketRow[]>("list"), marketAdmin<Dashboard>("dashboard"), marketAdmin<ChangeRequest[]>("change_requests")]);
    setMarkets(m); setDashboard(d); setRequests(r);
    setAuthorities(await marketSetup<RecordRow[]>("authorities"));
    if (scope) { setCurricula(await marketSetup<RecordRow[]>("curricula", { market_id: scope })); setSources(await marketSetup<RecordRow[]>("sources", { market_id: scope })); }
  }, [scope]);
  useEffect(() => { void load().catch((cause) => setError((cause as Error).message)); }, [load]);
  async function perform(work: () => Promise<void>, done: string) { if (busy) return; setBusy(true); setError(""); setNotice(""); try { await work(); setNotice(done); await load(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  const edit = (m: MarketRow) => { const c = m.configuration as Record<string, any>; setForm({ ...blank, id: m.id, country_code: m.country_code, country_name: m.country, name: m.name, currency_code: m.currency, timezone: m.timezone, locale: m.locale, is_test: m.is_test,
    levels: formatOptions(c.education_levels), grades: formatOptions(c.grades), subjects: formatOptions(c.subjects), self_practice: c.grade_policy?.self_practice ?? "STRICT_GRADE", sme_currency: c.sme_currency ?? "", sponsors_enabled: c.sponsors_enabled ?? true, competitions_enabled: c.competitions_enabled ?? true }); setTab("market"); };
  function saveMarket(event: FormEvent) {
    event.preventDefault();
    const configuration = { education_levels: parseOptions(form.levels), grades: parseOptions(form.grades), subjects: parseOptions(form.subjects), grade_policy: { self_practice: form.self_practice, teacher_assignment: "TEACHER_OVERRIDE" },
      sme_currency: form.sme_currency || form.currency_code, sponsors_enabled: form.sponsors_enabled, competitions_enabled: form.competitions_enabled };
    void perform(async () => { await marketAdmin("save_market", { ...form, id: form.id || null, configuration }); setForm(blank); setTab("markets"); }, "Market saved.");
  }
  const field = (key: keyof typeof blank, label: string, extra: Record<string, unknown> = {}) => <label>{label}<input className="dx-input" value={String(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...extra} /></label>;
  const area = (key: "levels" | "grades" | "subjects", label: string, hint: string) => <label>{label}<textarea className="dx-textarea" rows={4} placeholder={hint} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>;

  // Join the dashboard figures to each market by name.
  const figures = useMemo(() => new Map((dashboard?.markets ?? []).map((d) => [d.market, d])), [dashboard]);
  const stageCount = useMemo(() => Object.fromEntries(STAGES.map((s) => [s, markets.filter((m) => m.status === s).length])) as Record<MarketStatus, number>, [markets]);
  const shown = useMemo(() => markets.filter((m) => (!stage || m.status === stage) && (!ready || (ready === "yes") === m.readiness.ready) && (showTest || !m.is_test)
    && (!search.trim() || `${m.name} ${m.country} ${m.country_code}`.toLowerCase().includes(search.trim().toLowerCase()))), [markets, stage, ready, showTest, search]);
  const blockerRows = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of markets) if (!m.readiness.ready) for (const b of m.readiness.blockers) c.set(b, (c.get(b) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([b, n]) => ({ key: b, label: humanize(b.toLowerCase()), segments: [{ value: n, color: SERIES.b, name: "Markets" }] }));
  }, [markets]);
  const people = (dashboard?.markets ?? []).slice().sort((a, b) => b.users - a.users).map((d) => ({ key: d.market, label: d.market, segments: [
    { value: d.students, color: SERIES.a, name: "Students" }, { value: d.teachers, color: SERIES.b, name: "Teachers" }, { value: d.smes, color: SERIES.c, name: "SMEs" }, { value: d.sponsors, color: SERIES.d, name: "Sponsors" }] }));
  const bank = (dashboard?.markets ?? []).slice().sort((a, b) => b.questions - a.questions).map((d) => ({ key: d.market, label: d.market, segments: [
    { value: d.approved_questions, color: SERIES.a, name: "Approved" }, { value: Math.max(d.questions - d.approved_questions, 0), color: SERIES.none, name: "Not approved yet" }] }));
  const d = dashboard;
  const scoped = markets.find((m) => m.id === scope);

  return (
    <div className="dx-page">
      <div className="dx-head">
        <div><h1>Market setup</h1><p>Launch and govern countries. A market cannot become Active until its readiness check passes.</p></div>
        <div className="dx-actions">
          <button className="dx-btn" disabled={busy} aria-label="Refresh markets" onClick={() => void perform(async () => {}, "")}><RefreshCw size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Refresh</button>
          <button className="dx-btn primary" onClick={() => { setForm(blank); setTab("market"); }}>New market</button>
        </div>
      </div>

      <div className="dx-kpis">
        <Kpi label="Active markets" value={d?.active_markets ?? "—"} hint={d ? `${num(d.configured_markets)} configured` : undefined} />
        <Kpi label="Active competitions" value={d?.active_competitions ?? "—"} />
        <Kpi label="Attempts" value={d?.attempts ?? "—"} />
        <Kpi label="Source items to resolve" value={d?.unresolved_source_items ?? "—"} tone={d && d.unresolved_source_items > 0 ? "warn" : "default"} />
        <Kpi label="Compensation to resolve" value={d?.unresolved_compensation ?? "—"} tone={d && d.unresolved_compensation > 0 ? "warn" : "default"} />
        <Kpi label="Market changes waiting" value={d?.pending_market_changes ?? "—"} tone={d && d.pending_market_changes > 0 ? "warn" : "default"} hint={requests.length ? "Open the Country changes tab" : undefined} />
      </div>

      <div className="dx-grid">
        <Panel title="People by market" subtitle="Click a market to see its row"
          action={<ul className="dx-legend" aria-label="Legend" style={{ margin: 0 }}><li><span className="dx-swatch" style={{ background: SERIES.a }} />Students</li><li><span className="dx-swatch" style={{ background: SERIES.b }} />Teachers</li><li><span className="dx-swatch" style={{ background: SERIES.c }} />SMEs</li><li><span className="dx-swatch" style={{ background: SERIES.d }} />Sponsors</li></ul>}>
          {dashboard ? (people.length ? <RankedBars rows={people} limit={8} unit="people" onPick={(k) => { setSearch(k); setTab("markets"); }} active={search} /> : <p className="dx-muted dx-note">No markets yet.</p>) : <p className="dx-muted dx-note">Loading…</p>}
        </Panel>
        <Panel title="Question bank by market" subtitle="Approved and not yet approved"
          action={<ul className="dx-legend" aria-label="Legend" style={{ margin: 0 }}><li><span className="dx-swatch" style={{ background: SERIES.a }} />Approved</li><li><span className="dx-swatch" style={{ background: SERIES.none }} />Not yet</li></ul>}>
          {dashboard ? <RankedBars rows={bank} limit={8} unit="questions" /> : <p className="dx-muted dx-note">Loading…</p>}
        </Panel>
        <div className="dx-stack">
          <Panel title="Launch stage" subtitle="Click a stage to filter the table">
            <RankedBars rows={STAGES.map((s) => ({ key: s, label: humanize(s.toLowerCase()), segments: [{ value: stageCount[s] ?? 0, color: SERIES.a, name: "Markets" }] }))} active={stage ? stage : undefined} unit="markets"
              onPick={(k) => { setStage(stage === k ? "" : (k as MarketStatus)); setTab("markets"); }} limit={5} />
          </Panel>
          <Panel title="What is blocking launch" subtitle="Markets that are not ready">
            {blockerRows.length ? <RankedBars rows={blockerRows} limit={5} unit="markets" /> : <p className="dx-muted dx-note">{markets.length ? "Nothing is blocking any market." : "No markets yet."}</p>}
          </Panel>
        </div>
      </div>

      {error && <div className="dx-alert error" role="alert">{error}</div>}
      {notice && <div className="dx-alert ok" role="status">{notice}</div>}

      <div className="dx-toolbar">
        <Segmented<Tab> label="Section" value={tab} onChange={setTab}
          options={[{ value: "markets", label: "Markets", count: markets.length }, { value: "curricula", label: "Curricula and sources" }, { value: "requests", label: "Country changes", count: requests.length },
            { value: "market", label: form.id ? "Edit market" : "New market" }, { value: "curriculum", label: "Register curriculum" }]} />
        {tab === "markets" && <>
          <select className="dx-select" aria-label="Launch stage" value={stage} onChange={(e) => setStage(e.target.value as typeof stage)}><option value="">All stages</option>{STAGES.map((s) => <option key={s} value={s}>{humanize(s.toLowerCase())} ({stageCount[s] ?? 0})</option>)}</select>
          <select className="dx-select" aria-label="Readiness" value={ready} onChange={(e) => setReady(e.target.value as typeof ready)}><option value="">Ready and not ready</option><option value="yes">Ready</option><option value="no">Not ready</option></select>
          <label className="dx-check"><input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} />Show test markets</label>
          <input className="dx-input" type="search" placeholder="Search market or country" aria-label="Search markets" value={search} onChange={(e) => setSearch(e.target.value)} />
          {(stage || ready || search || !showTest) && <button className="dx-link" type="button" onClick={() => { setStage(""); setReady(""); setSearch(""); setShowTest(true); }}>Clear filters</button>}
        </>}
      </div>

      {tab === "markets" && (
        <>
          <div className="dx-table-wrap">
            <table className="dx-table">
              <thead><tr><th>Market</th><th>Country</th><th>Stage</th><th>Ready</th><th className="num">Users</th><th className="num">Students</th><th className="num">Teachers</th><th className="num">Questions</th><th>Sources</th><th>Currency / locale</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {!markets.length ? <tr><td colSpan={11} className="dx-muted">{dashboard ? "No markets yet." : "Loading…"}</td></tr> : !shown.length ? <tr><td colSpan={11} className="dx-muted">No markets match.</td></tr> : shown.map((m) => {
                  const f = figures.get(m.name);
                  return (
                    <tr key={m.id}>
                      <td className="name">{m.name}{m.is_test && <> <span className="dx-pill warn" title="Test market, hidden from signup">test</span></>}</td>
                      <td>{m.country} ({m.country_code})</td>
                      <td><span className={`dx-pill ${STAGE_TONE[m.status]}`}>{humanize(m.status.toLowerCase())}</span></td>
                      <td title={m.readiness.ready ? "Ready" : m.readiness.blockers.map((b) => b.replaceAll("_", " ")).join(", ")}>
                        {m.readiness.ready ? <span className="dx-pill ok">Ready</span> : <span className="dx-pill warn">{m.readiness.blockers.length} blocker{m.readiness.blockers.length === 1 ? "" : "s"}</span>}
                        <span className="dx-muted"> · SME {m.readiness.sme_coverage}</span>
                      </td>
                      <td className="num">{f ? num(f.users) : "—"}</td><td className="num">{f ? num(f.students) : "—"}</td><td className="num">{f ? num(f.teachers) : "—"}</td>
                      <td className="num" title="Approved of total">{f ? `${num(f.approved_questions)} / ${num(f.questions)}` : "—"}</td>
                      <td>{m.readiness.sources ? <><span>{m.readiness.sources.active} active</span><span className="dx-muted"> · {m.readiness.sources.pending} pending</span></> : <span className="dx-muted">—</span>}</td>
                      <td className="dx-muted">{m.currency} · {m.locale}</td>
                      <td>
                        <div className="dx-actions" style={{ flexWrap: "nowrap" }}>
                          <button className="dx-btn sm" disabled={busy} onClick={() => edit(m)}>Edit</button>
                          {NEXT[m.status].map((s) => <button key={s} className="dx-btn sm" disabled={busy} title={`Move to ${humanize(s.toLowerCase())}`}
                            onClick={() => void perform(async () => { const r = await marketAdmin<{ changed: boolean; blockers: string[] }>("set_status", { market_id: m.id, status: s }); if (!r.changed) throw new Error(`Not ready: ${r.blockers.join(", ")}`); }, `Status changed to ${s}.`)}>{humanize(s.toLowerCase())}</button>)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="dx-pager"><span>{num(shown.length)} of {num(markets.length)} markets</span><span className="dx-muted">The small buttons next to Edit move the market to that stage. A market cannot become Active until it is ready.</span></div>
        </>
      )}

      {tab === "curricula" && (
        <Panel title="Curricula, sources and admins" subtitle="Pick a market to see its curricula and official sources"
          action={<select className="dx-select" aria-label="Setup market" value={scope} onChange={(e) => setScope(e.target.value)}><option value="">Select market</option>{markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}>
          {!scope ? <p className="dx-muted dx-note">Choose a market above.</p> : <div style={{ display: "grid", gap: 10 }}>
            <div className="dx-kpis">
              <Kpi label="Curricula" value={curricula.length} hint={`${curricula.filter((c) => c.active).length} active`} />
              <Kpi label="Official sources" value={sources.length} hint={`${sources.filter((x) => x.validation_status === "approved").length} approved`} />
              <Kpi label="Sources to approve" value={sources.filter((x) => x.validation_status !== "approved").length} tone={sources.some((x) => x.validation_status !== "approved") ? "warn" : "default"} />
              <Kpi label="Market" value={scoped ? humanize(scoped.status.toLowerCase()) : "—"} hint={scoped?.name} />
            </div>
            <div className="dx-table-wrap"><table className="dx-table"><thead><tr><th>Curriculum</th><th>Authority</th><th className="num">Nodes</th><th className="num">Approved sources</th><th>Status</th><th aria-label="Action" /></tr></thead><tbody>
              {!curricula.length ? <tr><td colSpan={6} className="dx-muted">No curricula yet.</td></tr> : curricula.map((c) => <tr key={c.curriculum_id}><td className="name">{c.code} · {c.name} ({c.version})</td><td>{c.authority ?? "-"}</td><td className="num">{c.nodes}</td><td className="num">{c.approved_sources}</td>
                <td><span className={`dx-pill ${c.active ? "ok" : ""}`}>{c.active ? "Active" : "Inactive"}</span></td>
                <td><button className="dx-btn sm" disabled={busy} onClick={() => void perform(async () => { await marketSetup(c.active ? "deactivate_curriculum" : "activate_curriculum", { curriculum_id: c.curriculum_id }); }, c.active ? "Curriculum deactivated." : "Curriculum activated.")}>{c.active ? "Deactivate" : "Activate"}</button></td></tr>)}
            </tbody></table></div>
            <div className="dx-table-wrap"><table className="dx-table"><thead><tr><th>Official source</th><th>Rights</th><th>Extracted text</th><th>Status</th><th aria-label="Action" /></tr></thead><tbody>
              {!sources.length ? <tr><td colSpan={5} className="dx-muted">No official sources yet.</td></tr> : sources.map((s) => <tr key={s.id}><td className="name">{s.title}</td><td>{s.rights_confirmed ? <span className="dx-pill ok">Confirmed</span> : <span className="dx-pill warn">Missing</span>}</td><td>{s.has_text ? "Yes" : "No"}</td><td>{s.validation_status}</td>
                <td>{s.validation_status !== "approved" && <button className="dx-btn sm" disabled={busy} onClick={() => void perform(async () => { await marketSetup("approve_source", { market_id: scope, source_id: s.id }); }, "Source approved.")}>Approve</button>}</td></tr>)}
            </tbody></table></div>
            <form className="dx-form" style={{ gridTemplateColumns: "minmax(220px, 360px) auto" }} onSubmit={(e) => { e.preventDefault(); void perform(async () => { await marketSetup("add_market_admin", { market_id: scope, email: adminEmail }); setAdminEmail(""); }, "Market admin added."); }}>
              <label>Add a market admin by email<input className="dx-input" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required /></label>
              <div><button className="dx-btn primary" disabled={busy}>Add market admin</button></div>
            </form>
          </div>}
        </Panel>
      )}

      {tab === "requests" && (
        <Panel title="Country change requests" subtitle="People who asked to move to another market">
          <div className="dx-table-wrap"><table className="dx-table"><thead><tr><th>Person</th><th>Role</th><th>From</th><th>To</th><th>Reason</th><th aria-label="Decision" /></tr></thead><tbody>
            {!requests.length ? <tr><td colSpan={6} className="dx-muted">No pending requests.</td></tr> : requests.map((r) => <tr key={r.id}><td className="name">{r.user}</td><td>{r.role}</td><td>{r.from ?? "-"}</td><td>{r.to}</td><td style={{ whiteSpace: "normal", minWidth: 220 }}>{r.reason}</td>
              <td><div className="dx-actions" style={{ flexWrap: "nowrap" }}>{(["APPROVED", "REJECTED"] as const).map((x) => <button key={x} className={`dx-btn sm${x === "APPROVED" ? " primary" : ""}`} disabled={busy} onClick={() => void perform(async () => { await marketAdmin("decide_change", { request_id: r.id, decision: x }); }, `Request ${x.toLowerCase()}.`)}>{x === "APPROVED" ? "Approve" : "Reject"}</button>)}</div></td></tr>)}
          </tbody></table></div>
        </Panel>
      )}

      {tab === "market" && (
        <Panel title={form.id ? "Edit market" : "New market"} subtitle="Teacher cross-grade assignments always require an explicit, audited override.">
          <form className="dx-form" onSubmit={saveMarket}>
            {field("country_code", "Country ISO-2", { required: true, maxLength: 2 })}{!form.id && field("country_iso3", "Country ISO-3", { maxLength: 3 })}{field("country_name", "Country name", { required: !form.id })}
            {field("name", "Market name", { required: true })}{field("currency_code", "Currency (ISO 4217)", { required: true, maxLength: 3 })}{!form.id && field("currency_name", "Currency name (if new)")}
            {field("timezone", "Time zone", { required: true, placeholder: "e.g. Africa/Lagos" })}{field("locale", "Locale", { required: true, placeholder: "e.g. en-NG" })}
            <label>Self-practice grade policy<select className="dx-select" value={form.self_practice} onChange={(e) => setForm({ ...form, self_practice: e.target.value })}><option value="STRICT_GRADE">Strict grade</option><option value="OPEN_LEVEL">Open level (explicit)</option></select></label>
            {field("sme_currency", "Default SME currency", { maxLength: 3 })}
            {area("levels", "Education levels", "CODE: Label")}{area("grades", "Grades", "CODE: Label | LEVEL_CODE")}{area("subjects", "Subjects", "CODE: Label")}
            <div className="dx-checks">
              <label className="dx-check"><input type="checkbox" checked={form.sponsors_enabled} onChange={(e) => setForm({ ...form, sponsors_enabled: e.target.checked })} />Sponsors available</label>
              <label className="dx-check"><input type="checkbox" checked={form.competitions_enabled} onChange={(e) => setForm({ ...form, competitions_enabled: e.target.checked })} />Competitions available</label>
              <label className="dx-check"><input type="checkbox" checked={form.is_test} onChange={(e) => setForm({ ...form, is_test: e.target.checked })} />Test market (never shown to real users)</label>
            </div>
            <div className="dx-actions"><button className="dx-btn primary" disabled={busy}><Save size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Save market</button>{form.id && <button type="button" className="dx-btn" onClick={() => { setForm(blank); setTab("markets"); }}>Cancel</button>}</div>
          </form>
        </Panel>
      )}

      {tab === "curriculum" && (
        <Panel title="Register a curriculum" subtitle="New curricula start inactive.">
          <p className="dx-muted dx-note" style={{ marginTop: 0 }}>Add the authority under <Link href="/admin/markets">Markets › Authorities</Link>, ingest and approve official sources, then activate the curriculum under Curricula and sources.</p>
          <form className="dx-form" onSubmit={(e) => { e.preventDefault(); void perform(async () => { await marketAdmin("save_curriculum", curriculum); }, "Curriculum registered (inactive)."); }}>
            <label>Market<select className="dx-select" value={curriculum.market_id} onChange={(e) => setCurriculum({ ...curriculum, market_id: e.target.value })} required><option value="">Select</option>{markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            <label>Authority<select className="dx-select" value={curriculum.authority_id} onChange={(e) => setCurriculum({ ...curriculum, authority_id: e.target.value })} required><option value="">Select</option>{authorities.filter((a) => a.market_id === curriculum.market_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            {CURRICULUM_FIELDS.map(({ key: k, label, placeholder, hint, pattern }) => <label key={k} title={hint}>{label}<input className="dx-input" value={curriculum[k]} placeholder={placeholder} pattern={pattern} title={hint} onChange={(e) => setCurriculum({ ...curriculum, [k]: e.target.value })} required /></label>)}
            <label>Effective from<input className="dx-input" type="date" value={curriculum.effective_from} onChange={(e) => setCurriculum({ ...curriculum, effective_from: e.target.value })} /></label>
            <label>Effective to<input className="dx-input" type="date" value={curriculum.effective_to} onChange={(e) => setCurriculum({ ...curriculum, effective_to: e.target.value })} /></label>
            <p className="dx-muted dx-note" style={{ gridColumn: "1 / -1" }}>Source SHA-256: in PowerShell run <code>{`Get-FileHash "curriculum.pdf"`}</code> and paste the Hash value.</p>
            <div><button className="dx-btn primary" disabled={busy}><Plus size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Register curriculum</button></div>
          </form>
        </Panel>
      )}
    </div>
  );
}
