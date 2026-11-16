"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import StatusBadge from "@/components/StatusBadge";
import { formatDateTime, humanize, isUuid, shortId } from "@/lib/format";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, RefreshCw, Save, Pencil, X, Check, Plus } from "lucide-react";
import { actOnSmePayout, ConfigEntity, createSmePayout, getSmeContext, listSmeRecords, ReadEntity, RecordRow, releaseSmeEarning, saveSmeConfiguration, SmeContext } from "@/lib/api/sme";
import { configurationPayload, SME_CONFIG_FIELDS } from "@/lib/sme/configuration";
import { userFacingError } from "@/lib/errors";
import CompetitionContentScope from "@/components/CompetitionContentScope";
import CurriculumCascade from "@/components/CurriculumCascade";
import { getCurriculumCatalogue } from "@/lib/api/sme";
import type { Catalogue } from "@/lib/sme/catalogue";
import { Kpi, Segmented, num } from "@/components/admin/DataViz";

type Area = "markets" | "reviewers" | "compensation" | "performance" | "payouts";
const areas: Record<Area, { title: string; entities: ReadEntity[] }> = {
  markets: { title: "Markets", entities: ["countries", "markets", "currencies", "curriculum_authorities", "market_curricula", "user_market_memberships", "source_documents"] },
  reviewers: { title: "SME Reviewers", entities: ["sme_profiles", "sme_domain_assignments", "user_capabilities"] },
  compensation: { title: "Compensation", entities: ["compensation_policies", "compensation_policy_versions"] },
  performance: { title: "SME Performance", entities: ["sme_performance", "sme_financial_performance"] },
  payouts: { title: "Payouts", entities: ["sme_earnings_current", "sme_payout_batch_summary", "sme_payout_item_details"] },
};
const titles: Record<string, string> = { countries: "Countries", markets: "Markets", currencies: "Currencies", sme_profiles: "Profiles", sme_domain_assignments: "Domains", user_capabilities: "Capabilities", compensation_policies: "Policies", compensation_policy_versions: "Historical Versions", sme_performance: "Review Work", sme_financial_performance: "Earnings by Currency", sme_earnings_current: "Earnings", sme_payout_batch_summary: "Batches", sme_payout_item_details: "Batch Items" };
Object.assign(titles,{curriculum_authorities:"Authorities",market_curricula:"Curricula by Market",user_market_memberships:"User / Sponsor Markets",source_documents:"Source Documents"});
const hidden = new Set(["created_at", "updated_at", "configuration", "bio", "qualification_summary", "content_text"]);
// Readable cells: short IDs, formatted timestamps, status badges, summarised objects.
const text = (value: unknown, column = ""): ReactNode => {
  if (value == null || value === "") return <span className="dx-muted">—</span>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (/(^|_)status$/.test(column) && typeof value === "string") return <StatusBadge status={value} />;
  if (/_at$/.test(column)) return formatDateTime(value);
  if (isUuid(value)) return <span className="dx-muted" title={String(value)}>{shortId(value)}</span>;
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${humanize(key)}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`).join(" · ");
  return String(value);
};

export default function SmeAdmin({ area }: { area: Area }) {
  const pathname = usePathname();
  const [context, setContext] = useState<SmeContext | null>(null);
  const [entity, setEntity] = useState<ReadEntity>(areas[area].entities[0]);
  const [rows, setRows] = useState<RecordRow[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1);
  const [editing, setEditing] = useState<RecordRow | null>(null), [creating, setCreating] = useState(false);
  const [options, setOptions] = useState<Record<string, RecordRow[]>>({});
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [earningsStatus, setEarningsStatus] = useState("payable");
  const [note, setNote] = useState("");
  const supportEntities = ["sme_profiles", "sme_domain_assignments"];
  // Reviewer support (capability sme_support, granted by a super admin) manages reviewer profiles and domains; everything else stays super admin.
  const allowed = context && (area === "payouts" || area === "performance" ? context.finance_admin || context.super_admin : context.super_admin || (area === "reviewers" && context.sme_support));
  const canWrite = Boolean(context && (context.super_admin || (context.sme_support && supportEntities.includes(entity))));
  const fields = SME_CONFIG_FIELDS[entity];
  const load = useCallback(async () => {
    if (!allowed) return;
    setBusy(true); setError("");
    try {
      const result = await listSmeRecords(entity, entity === "sme_earnings_current" ? { current_status: earningsStatus } : {}, page);
      setRows(result.rows); setTotal(result.total);
    } catch (cause) { setError(userFacingError(cause)); }
    finally { setBusy(false); }
  }, [allowed, entity, page, earningsStatus]);
  useEffect(() => { getSmeContext().then(setContext).catch(cause => setError(userFacingError(cause))); }, []);
  useEffect(() => { if (allowed && entity === "sme_domain_assignments" && !catalogue) getCurriculumCatalogue().then(setCatalogue).catch(cause => setError(userFacingError(cause))); }, [allowed, entity, catalogue]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!allowed) return;
    const sources = [...new Set((fields ?? []).map(f => f.source).filter(Boolean))] as ConfigEntity[];
    Promise.all(sources.map(async source => [source, (await listSmeRecords(source)).rows] as const)).then(entries => setOptions(Object.fromEntries(entries))).catch(cause => setError(userFacingError(cause)));
  }, [allowed, fields]);
  const perform = async (operation: () => Promise<unknown>, message: string) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await operation(); setNotice(message); setEditing(null); setCreating(false); setSelected([]); await load(); }
    catch (cause) { setError(cause instanceof Error && !cause.message.startsWith("QB_") ? cause.message : userFacingError(cause)); }
    finally { setBusy(false); }
  };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void perform(async () => saveSmeConfiguration(entity as ConfigEntity, configurationPayload(entity, form, editing?.id)), "Configuration saved.");
  };
  const payout = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void perform(() => createSmePayout(String(data.get("market_id")), String(data.get("currency_code")), new Date(String(data.get("start"))).toISOString(), new Date(String(data.get("end"))).toISOString(), selected), "Payout batch created.");
  };
  const columns = rows.length ? Object.keys(rows[0]).filter(key => !hidden.has(key)) : [];
  if (!context) return <div className="dx-page">{error ? <div className="dx-alert error" role="alert">{error}</div> : <p className="dx-muted">Loading...</p>}</div>;
  if (!allowed) return <div className="dx-page"><div className="dx-alert error" role="alert">You do not have permission to manage this area.</div></div>;
  const sections = Object.entries({ markets: "Markets", reviewers: "SME Reviewers", compensation: "Compensation", "sme-performance": "Performance", payouts: "Payouts" }).filter(([path]) => context.super_admin || ["sme-performance", "payouts"].includes(path) || (context.sme_support && path === "reviewers"));
  const views = areas[area].entities.filter(item => context.super_admin || !(area === "reviewers" && !supportEntities.includes(item)));
  return <div className="dx-page">
    <div className="dx-head"><div><h1>{areas[area].title}</h1><p>{titles[entity]}: records, filters and actions for this area.</p></div>
      <div className="dx-actions"><button className="dx-btn" title="Refresh" aria-label="Refresh" disabled={busy} onClick={() => void load()}><RefreshCw size={14}/> Refresh</button></div></div>
    <div className="dx-kpis">
      <Kpi label="Records in this view" value={num(total)} hint={titles[entity]} />
      <Kpi label="On this page" value={num(rows.length)} hint={`page ${page}`} />
      {entity === "sme_earnings_current" && <Kpi label="Selected for a payout" value={selected.length} hint={`status: ${earningsStatus}`} tone={selected.length ? "warn" : "default"} />}
    </div>
    <nav className="dx-toolbar" aria-label="SME administration">{sections.map(([path, label]) => <Link key={path} className={`dx-btn sm${`/admin/${path}` === pathname ? " primary" : ""}`} href={`/admin/${path}`}>{label}</Link>)}</nav>
    <nav className="dx-toolbar" aria-label="Administration views"><Segmented<string> label="Administration views" value={entity} onChange={item => { if (busy) return; setEntity(item as ReadEntity); setRows([]); setPage(1); setCreating(false); setEditing(null); setSelected([]); }} options={views.map(item => ({ value: item, label: titles[item] }))} /></nav>
    {error && <div role="alert" className="dx-alert error">{error}</div>}{notice && <div role="status" className="dx-alert ok">{notice}</div>}
    {fields && canWrite && entity!=="source_documents" && <div className="dx-toolbar"><button className="dx-btn primary" disabled={busy} onClick={() => { setCreating(true); setEditing(null); }}><Plus size={14}/> {entity === "compensation_policy_versions" ? "New Version" : "Create"}</button></div>}
    {fields && (creating || editing) && <section className="dx-panel"><div className="dx-panel-head"><h2>{editing ? "Edit" : "Create"} {titles[entity]}</h2><button className="dx-btn sm" title="Close" aria-label="Close" onClick={() => { setCreating(false); setEditing(null); }}><X size={14}/> Close</button></div>
      <form key={editing?.id ?? editing?.user_id ?? editing?.code ?? `${entity}-new`} className="dx-form" onSubmit={save}>
        {fields.map(f => {
          if (entity === "sme_domain_assignments" && catalogue) {
            if (f.name === "subject_code") return <CurriculumCascade key="cascade" catalogue={catalogue} disabled={busy}
              initial={{ market: editing?.market_id, level: editing?.education_level, grades: editing?.grade_codes, subject: editing?.subject_code }}/>;
            if (["market_id", "education_level", "grade_codes"].includes(f.name)) return null;
          }
          const initial = f.name === "require_senior_qa" ? editing?.configuration?.require_senior_qa : editing?.[f.name];
          const value = Array.isArray(initial) ? initial.join(", ") : f.type === "datetime-local" && initial ? new Date(initial).toISOString().slice(0, 16) : initial ?? "";
          return <label key={f.name}>{f.label}{f.type === "checkbox" ? <input type="checkbox" name={f.name} defaultChecked={Boolean(initial)} disabled={busy}/> : f.type === "textarea" ? <textarea className="dx-textarea" name={f.name} defaultValue={value} required={!f.optional} disabled={busy}/>
            : f.type === "select" ? <select className="dx-select" name={f.name} defaultValue={value} required={!f.optional} disabled={busy}><option value="">Select</option>{f.options?.map(option => <option key={option}>{option}</option>)}</select>
            : <><input className="dx-input" name={f.name} type={f.source ? "text" : f.type ?? "text"} list={f.source ? `sme-${f.name}` : undefined} defaultValue={f.name === "withholding_percentage" ? editing?.tax_or_withholding?.percentage ?? "" : value} required={!f.optional} min={f.min} step={f.type === "number" ? "0.000001" : undefined} disabled={busy}/>{f.source && <datalist id={`sme-${f.name}`}>{(options[f.source] ?? []).map(row => <option key={row[f.valueKey ?? "id"]} value={row[f.valueKey ?? "id"]}>{row.name ?? row.reviewer_tier ?? row.user_id}</option>)}</datalist>}</>}
          </label>;
        })}<button className="dx-btn primary" type="submit" disabled={busy}><Save size={14}/> Save</button>
      </form>
    </section>}
    {entity === "sme_earnings_current" && <div className="dx-toolbar"><label className="dx-muted" style={{ fontSize: 12.5 }}>Earning status <select className="dx-select" value={earningsStatus} disabled={busy} onChange={event => { setEarningsStatus(event.target.value); setPage(1); setSelected([]); }}>{["payable", "pending_qa", "held", "paid", "reversed"].map(status => <option key={status}>{status}</option>)}</select></label></div>}
    <div className="dx-table-wrap" aria-busy={busy}><table className="dx-table"><thead><tr>{entity === "sme_earnings_current" && <th>Select</th>}{columns.map(column => <th key={column}>{humanize(column)}</th>)}<th><span className="qb-sr-only">Actions</span></th></tr></thead><tbody>{rows.map((row, i) => <tr key={entity==="user_market_memberships" ? `${row.user_id}-${row.market_id}` : row.id ?? row.curriculum_id ?? row.user_id ?? `${row.reviewer_id}-${row.currency_code ?? i}`}>
      {entity === "sme_earnings_current" && <td><input type="checkbox" aria-label={`Select earning ${row.id}`} checked={selected.includes(row.id)} disabled={busy || row.current_status !== "payable"} onChange={event => setSelected(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))}/></td>}
      {columns.map(column => <td key={column} style={{ overflowWrap: "anywhere", maxWidth: 260, whiteSpace: "normal" }}>{text(row[column], column)}</td>)}
      <td>{fields && entity !== "compensation_policy_versions" && <button className="dx-btn sm" disabled={busy} aria-label="Edit configuration" title="Edit configuration" onClick={() => { setEditing(row); setCreating(false); }}><Pencil size={14}/></button>}
        {entity === "sme_payout_batch_summary" && row.status !== "paid" && <button className="dx-btn sm primary" disabled={busy} onClick={() => void perform(() => actOnSmePayout(row.id, row.status === "draft" ? "approve" : "paid"), row.status === "draft" ? "Batch approved." : "Batch marked paid.")}><Check size={14}/> {row.status === "draft" ? "Approve" : "Mark Paid"}</button>}
        {entity === "sme_earnings_current" && ["pending_qa", "held"].includes(row.current_status) && <button className="dx-btn sm primary" disabled={busy || note.trim().length < 3 || Boolean(row.current_payout_batch_id)} onClick={() => void perform(() => releaseSmeEarning(row.id, "payable", note), "Earning released.")}>Release after QA</button>}
        {entity === "sme_earnings_current" && ["pending_qa", "payable"].includes(row.current_status) && <button className="dx-btn sm" disabled={busy || note.trim().length < 3} onClick={() => void perform(() => releaseSmeEarning(row.id, "held", note), "Earning held.")}>Hold</button>}
      </td></tr>)}</tbody></table>{!rows.length && <p className="dx-muted dx-note">{busy ? "Loading..." : "No records."}</p>}</div>
    <div className="dx-pager"><span>{num(total)} records</span><span className="dx-spacer" /><button className="dx-btn sm" title="Previous page" aria-label="Previous page" disabled={busy || page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={14}/></button><span> {page} </span><button className="dx-btn sm" title="Next page" aria-label="Next page" disabled={busy || page * 50 >= total} onClick={() => setPage(page + 1)}><ChevronRight size={14}/></button></div>
    {entity === "sme_earnings_current" && <section className="dx-panel"><div className="dx-panel-head"><h2>Create a payout batch</h2></div>
      <label className="dx-muted" style={{ fontSize: 12.5, display: "block" }}>QA / hold note (needed to release or hold an earning)<textarea className="dx-textarea" minLength={3} maxLength={1000} value={note} onChange={event => setNote(event.target.value)}/></label>
      <form className="dx-form" onSubmit={payout}><label>Market UUID<input className="dx-input" name="market_id"/></label><label>Currency code<input className="dx-input" name="currency_code" required pattern="[A-Z]{3}"/></label><label>Period start<input className="dx-input" name="start" type="datetime-local" required/></label><label>Period end<input className="dx-input" name="end" type="datetime-local" required/></label><button className="dx-btn primary" type="submit" disabled={busy || !selected.length}><Plus size={14}/> Create batch ({selected.length})</button></form></section>}
    {area==="markets" && <CompetitionContentScope/>}
  </div>;
}
