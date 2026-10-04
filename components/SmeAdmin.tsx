"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import StatusBadge from "@/components/StatusBadge";
import { formatDateTime, humanize, isUuid, shortId } from "@/lib/format";
import Link from "next/link";
import { ChevronLeft, ChevronRight, RefreshCw, Save, Pencil, X, Check, Plus } from "lucide-react";
import { actOnSmePayout, ConfigEntity, createSmePayout, getSmeContext, listSmeRecords, ReadEntity, RecordRow, releaseSmeEarning, saveSmeConfiguration, SmeContext } from "@/lib/api/sme";
import { configurationPayload, SME_CONFIG_FIELDS } from "@/lib/sme/configuration";
import { userFacingError } from "@/lib/errors";
import CompetitionContentScope from "@/components/CompetitionContentScope";

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
  if (value == null || value === "") return <span className="qb-muted">—</span>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (/(^|_)status$/.test(column) && typeof value === "string") return <StatusBadge status={value} />;
  if (/_at$/.test(column)) return formatDateTime(value);
  if (isUuid(value)) return <span className="qb-mono" title={String(value)}>{shortId(value)}</span>;
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${humanize(key)}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`).join(" · ");
  return String(value);
};

export default function SmeAdmin({ area }: { area: Area }) {
  const [context, setContext] = useState<SmeContext | null>(null);
  const [entity, setEntity] = useState<ReadEntity>(areas[area].entities[0]);
  const [rows, setRows] = useState<RecordRow[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1);
  const [editing, setEditing] = useState<RecordRow | null>(null), [creating, setCreating] = useState(false);
  const [options, setOptions] = useState<Record<string, RecordRow[]>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [earningsStatus, setEarningsStatus] = useState("payable");
  const [note, setNote] = useState("");
  const allowed = context && (area === "payouts" || area === "performance" ? context.finance_admin || context.super_admin : context.super_admin);
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
  if (!context) return <div>{error ? <p className="qb-error" role="alert">{error}</p> : "Loading..."}</div>;
  if (!allowed) return <p className="qb-error" role="alert">You do not have permission to manage this area.</p>;
  return <div className="qb-content-ops">
    <div className="qb-page-head"><h1>{areas[area].title}</h1><button title="Refresh" aria-label="Refresh" disabled={busy} onClick={() => void load()}><RefreshCw size={18}/></button></div>
    <nav className="qb-content-tabs" aria-label="SME administration">{Object.entries({ markets: "Markets", reviewers: "SME Reviewers", compensation: "Compensation", "sme-performance": "Performance", payouts: "Payouts" }).filter(([path]) => context.super_admin || ["sme-performance", "payouts"].includes(path)).map(([path, label]) => <Link key={path} href={`/admin/${path}`}>{label}</Link>)}</nav>
    <nav className="qb-content-tabs" aria-label="Administration views">{areas[area].entities.map(item => <button key={item} disabled={busy} aria-current={entity === item ? "page" : undefined} onClick={() => { setEntity(item); setRows([]); setPage(1); setCreating(false); setEditing(null); setSelected([]); }}>{titles[item]}</button>)}</nav>
    {error && <p role="alert" className="qb-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {fields && context.super_admin && entity!=="source_documents" && <button disabled={busy} onClick={() => { setCreating(true); setEditing(null); }}><Plus size={16}/> {entity === "compensation_policy_versions" ? "New Version" : "Create"}</button>}
    {fields && (creating || editing) && <section className="qb-content-review"><div className="qb-page-head"><h2>{editing ? "Edit" : "Create"} {titles[entity]}</h2><button title="Close" aria-label="Close" onClick={() => { setCreating(false); setEditing(null); }}><X size={18}/></button></div>
      <form key={editing?.id ?? editing?.user_id ?? editing?.code ?? `${entity}-new`} className="qb-content-filters" onSubmit={save}>
        {fields.map(f => {
          const initial = f.name === "require_senior_qa" ? editing?.configuration?.require_senior_qa : editing?.[f.name];
          const value = Array.isArray(initial) ? initial.join(", ") : f.type === "datetime-local" && initial ? new Date(initial).toISOString().slice(0, 16) : initial ?? "";
          return <label key={f.name}>{f.label}{f.type === "checkbox" ? <input type="checkbox" name={f.name} defaultChecked={Boolean(initial)} disabled={busy}/> : f.type === "textarea" ? <textarea name={f.name} defaultValue={value} required={!f.optional} disabled={busy}/>
            : f.type === "select" ? <select name={f.name} defaultValue={value} required={!f.optional} disabled={busy}><option value="">Select</option>{f.options?.map(option => <option key={option}>{option}</option>)}</select>
            : <><input name={f.name} type={f.source ? "text" : f.type ?? "text"} list={f.source ? `sme-${f.name}` : undefined} defaultValue={f.name === "withholding_percentage" ? editing?.tax_or_withholding?.percentage ?? "" : value} required={!f.optional} min={f.min} step={f.type === "number" ? "0.000001" : undefined} disabled={busy}/>{f.source && <datalist id={`sme-${f.name}`}>{(options[f.source] ?? []).map(row => <option key={row[f.valueKey ?? "id"]} value={row[f.valueKey ?? "id"]}>{row.name ?? row.reviewer_tier ?? row.user_id}</option>)}</datalist>}</>}
          </label>;
        })}<button type="submit" disabled={busy}><Save size={16}/> Save</button>
      </form>
    </section>}
    {entity === "sme_earnings_current" && <label>Earning status<select value={earningsStatus} disabled={busy} onChange={event => { setEarningsStatus(event.target.value); setPage(1); setSelected([]); }}>{["payable", "pending_qa", "held", "paid", "reversed"].map(status => <option key={status}>{status}</option>)}</select></label>}
    <div className="qb-table-wrap" aria-busy={busy}><table className="qb-table"><thead><tr>{entity === "sme_earnings_current" && <th>Select</th>}{columns.map(column => <th key={column}>{humanize(column)}</th>)}<th><span className="qb-sr-only">Actions</span></th></tr></thead><tbody>{rows.map((row, i) => <tr key={entity==="user_market_memberships" ? `${row.user_id}-${row.market_id}` : row.id ?? row.curriculum_id ?? row.user_id ?? `${row.reviewer_id}-${row.currency_code ?? i}`}>
      {entity === "sme_earnings_current" && <td><input type="checkbox" aria-label={`Select earning ${row.id}`} checked={selected.includes(row.id)} disabled={busy || row.current_status !== "payable"} onChange={event => setSelected(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))}/></td>}
      {columns.map(column => <td key={column} style={{ overflowWrap: "anywhere", maxWidth: 260 }}>{text(row[column], column)}</td>)}
      <td>{fields && entity !== "compensation_policy_versions" && <button disabled={busy} aria-label="Edit configuration" title="Edit configuration" onClick={() => { setEditing(row); setCreating(false); }}><Pencil size={16}/></button>}
        {entity === "sme_payout_batch_summary" && row.status !== "paid" && <button disabled={busy} onClick={() => void perform(() => actOnSmePayout(row.id, row.status === "draft" ? "approve" : "paid"), row.status === "draft" ? "Batch approved." : "Batch marked paid.")}><Check size={16}/> {row.status === "draft" ? "Approve" : "Mark Paid"}</button>}
        {entity === "sme_earnings_current" && ["pending_qa", "held"].includes(row.current_status) && <button disabled={busy || note.trim().length < 3 || Boolean(row.current_payout_batch_id)} onClick={() => void perform(() => releaseSmeEarning(row.id, "payable", note), "Earning released.")}>Release after QA</button>}
        {entity === "sme_earnings_current" && ["pending_qa", "payable"].includes(row.current_status) && <button disabled={busy || note.trim().length < 3} onClick={() => void perform(() => releaseSmeEarning(row.id, "held", note), "Earning held.")}>Hold</button>}
      </td></tr>)}</tbody></table>{!rows.length && <p>{busy ? "Loading..." : "No records."}</p>}</div>
    <div className="qb-page-head"><span>{total} records</span><div><button title="Previous page" aria-label="Previous page" disabled={busy || page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={18}/></button><span> {page} </span><button title="Next page" aria-label="Next page" disabled={busy || page * 50 >= total} onClick={() => setPage(page + 1)}><ChevronRight size={18}/></button></div></div>
    {entity === "sme_earnings_current" && <><label>QA / hold note<textarea minLength={3} maxLength={1000} value={note} onChange={event => setNote(event.target.value)}/></label><h2>Create Payout Batch</h2><form className="qb-content-filters" onSubmit={payout}><label>Market UUID<input name="market_id"/></label><label>Currency code<input name="currency_code" required pattern="[A-Z]{3}"/></label><label>Period start<input name="start" type="datetime-local" required/></label><label>Period end<input name="end" type="datetime-local" required/></label><button type="submit" disabled={busy || !selected.length}><Plus size={16}/> Create Batch ({selected.length})</button></form></>}
    {area==="markets" && <CompetitionContentScope/>}
  </div>;
}
