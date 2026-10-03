"use client";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, UserPlus, Users } from "lucide-react";
import { sponsorWorkspaceRequest as call } from "@/lib/api/sponsor-workspace";
import { listAuthorizedMarkets, type MarketOption } from "@/lib/api/content-context";

type QueueRow = { candidate_id: string; competition_id: string; sponsor_id: string; sponsor_name: string | null; competition_title: string | null; market_name: string | null; subject: string; difficulty: string; stem: string; status: string; primary_assigned: boolean; primary_approved: boolean; senior_assigned: boolean; senior_required: boolean; primary_reviewer: string | null; senior_reviewer: string | null };
type Reviewer = { reviewer_id: string; domain_id: string; reviewer_name: string; subject: string; tier: string | null; can_approve: boolean; open_reviews: number };
const STATUSES = ["", "GENERATED", "ASSIGNED_FOR_REVIEW", "UNDER_REVIEW", "REVISION_REQUIRED", "APPROVED"];
const nextKind = (row: QueueRow) => !row.primary_assigned ? "primary" : row.senior_required && row.primary_approved && !row.senior_assigned ? "senior" : null;

// Content-admin assignment of sponsor competition candidates. Authorization is enforced by the server.
export default function CompetitionReviewAssignments() {
  const [markets, setMarkets] = useState<MarketOption[]>([]), [filters, setFilters] = useState({ market_id: "", subject: "", status: "GENERATED" });
  const [rows, setRows] = useState<QueueRow[]>([]), [reviewers, setReviewers] = useState<Record<string, Reviewer[]>>({}), [choice, setChoice] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]), [bulkReviewer, setBulkReviewer] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const queue = await call<QueueRow[]>("assignment_queue", null, filters); setRows(queue); setSelected([]);
    const eligible: Record<string, Reviewer[]> = {};
    for (const row of queue) { const kind = nextKind(row); if (kind) eligible[row.candidate_id] = await call<Reviewer[]>("eligible_reviewers", null, { candidate_id: row.candidate_id, kind }); }
    setReviewers(eligible);
  }, [filters]);
  useEffect(() => { listAuthorizedMarkets().then(setMarkets).catch(() => setMarkets([])); }, []);
  useEffect(() => { void load().catch(cause => setError((cause as Error).message)); }, [load]);
  async function perform(work: () => Promise<void>) { if (busy) return; setBusy(true); setError(""); setNotice(""); try { await work(); await load(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  const assign = (row: QueueRow, reviewer: Reviewer) => call("assign_candidate", row.sponsor_id, { competition_id: row.competition_id, candidate_id: row.candidate_id, reviewer_id: reviewer.reviewer_id, domain_id: reviewer.domain_id, kind: nextKind(row) });
  const bulkOptions = [...new Map(selected.flatMap(id => reviewers[id] ?? []).map(r => [r.reviewer_id, r])).values()];

  return <section className="qb-content-ops">
    <div className="qb-page-head"><h1>Competition review assignment</h1><button title="Refresh assignment queue" aria-label="Refresh assignment queue" disabled={busy} onClick={() => void perform(async () => {})}><RefreshCw size={16}/></button></div>
    {error && <p className="qb-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="qb-content-filters">
      <label>Market<select aria-label="Market filter" value={filters.market_id} onChange={e => setFilters({ ...filters, market_id: e.target.value })}><option value="">All authorized markets</option>{markets.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <label>Subject / domain<input aria-label="Subject filter" value={filters.subject} onChange={e => setFilters({ ...filters, subject: e.target.value })} placeholder="e.g. Safety"/></label>
      <label>Status<select aria-label="Status filter" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>{STATUSES.map(s => <option key={s} value={s}>{s ? s.replaceAll("_", " ") : "All open"}</option>)}</select></label>
    </div>
    {selected.length > 0 && <div className="qb-content-filters"><span>{selected.length} selected</span>
      <select aria-label="Bulk reviewer" value={bulkReviewer} onChange={e => setBulkReviewer(e.target.value)}><option value="">Choose reviewer</option>{bulkOptions.map(r => <option key={r.reviewer_id} value={r.reviewer_id}>{r.reviewer_name} · {r.open_reviews} open</option>)}</select>
      <button disabled={busy || !bulkReviewer} onClick={() => void perform(async () => {
        const outcomes: string[] = [];
        for (const id of selected) { const row = rows.find(r => r.candidate_id === id)!; const reviewer = reviewers[id]?.find(r => r.reviewer_id === bulkReviewer);
          if (!reviewer) { outcomes.push("not eligible"); continue; }
          await assign(row, reviewer).then(() => outcomes.push("assigned"), cause => outcomes.push((cause as Error).message)); }
        setNotice(`Bulk assignment: ${outcomes.filter(o => o === "assigned").length} assigned, ${outcomes.filter(o => o !== "assigned").length} skipped.`);
      })}><Users size={16}/>Assign selected</button></div>}
    <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Select</th><th>Question</th><th>Sponsor / competition</th><th>Market</th><th>Subject</th><th>Status</th><th>Reviewers</th><th>Assign</th></tr></thead><tbody>
      {rows.map(row => { const kind = nextKind(row), options = reviewers[row.candidate_id] ?? [];
        return <tr key={row.candidate_id}>
          <td><input type="checkbox" aria-label={`Select ${row.stem}`} disabled={!kind} checked={selected.includes(row.candidate_id)} onChange={e => setSelected(e.target.checked ? [...selected, row.candidate_id] : selected.filter(id => id !== row.candidate_id))}/></td>
          <td>{row.stem}<br/><small>{row.difficulty}</small></td><td>{row.sponsor_name ?? "Sponsor"}<br/><small>{row.competition_title}</small></td><td>{row.market_name ?? "-"}</td><td>{row.subject}</td>
          <td>{row.status.replaceAll("_", " ")}</td><td>{row.primary_reviewer ? `Primary: ${row.primary_reviewer}` : "Unassigned"}{row.senior_reviewer && <><br/>Senior: {row.senior_reviewer}</>}</td>
          <td>{kind ? options.length ? <div className="qb-content-filters"><select aria-label={`Reviewer for ${row.stem}`} value={choice[row.candidate_id] ?? ""} onChange={e => setChoice({ ...choice, [row.candidate_id]: e.target.value })}><option value="">Choose {kind} reviewer</option>{options.map(r => <option key={r.domain_id} value={r.domain_id}>{r.reviewer_name} · {r.subject}{r.tier ? ` · ${r.tier}` : ""} · {r.open_reviews} open</option>)}</select>
            <button disabled={busy || !choice[row.candidate_id]} onClick={() => void perform(async () => { await assign(row, options.find(r => r.domain_id === choice[row.candidate_id])!); setNotice("Review assigned."); })}><UserPlus size={16}/>Assign</button></div>
            : <small>No eligible reviewer</small> : <small>{row.status === "APPROVED" ? "Review complete" : row.status === "REJECTED" ? "Rejected" : "Assigned"}</small>}</td>
        </tr>; })}
    </tbody></table>{!rows.length && <p>{busy ? "Loading..." : "No candidates match these filters."}</p>}</div>
  </section>;
}
