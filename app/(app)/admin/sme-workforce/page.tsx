"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { factory, workforce, type Campaign } from "@/lib/api/factory";

type Money = Record<string, string>;
type Row = { reviewer_id: string; reviewer: string; status: string; market: string; subject: string; policy_id: string | null; mode: string | null; daily_limit: number | null; target_queue: number | null; max_queue: number | null;
  assigned_today: number; outstanding: number; completed_today: number; compensation_unresolved: number; payable: Money; pending_qa: Money; paid: Money;
  month: { completed: number; approved: number; revisions: number; rejected: number; qa_reversals: number; disputes: number; average_review_seconds: number | null; revision_rate: number; qa_reversal_rate: number } };
type Reviewer = { reviewer_id: string; name: string; domains: Array<{ subject: string; market: string | null; market_id: string | null; grades: string[]; level: string | null; can_senior_review: boolean }> };
type Policy = { id: string; reviewer: string; reviewer_id: string; market: string | null; subject_code: string | null; assignment_mode: string; review_kind: string; daily_limit: number | null; target_open_queue: number | null; max_open_queue: number; working_days: number[]; paused: boolean; active: boolean; campaign_id: string | null; allocation_quota: number | null; state: { capacity: number; outstanding: number; assigned_today: number; reason: string | null } | null };
type RunResult = { assigned: number; dry_run: boolean; policies: Array<{ reviewer: string; mode: string; kind: string; capacity: number; outstanding_before: number; eligible: number; assigned: number; reason: string | null; errors: string[] }> };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const money = (m: Money) => Object.entries(m ?? {}).map(([c, v]) => `${c} ${Number(v).toFixed(2)}`).join(", ") || "-";
const emptyPolicy = { reviewer_id: "", market_id: "", subject_code: "", grade_codes: "", review_kind: "primary", assignment_mode: "TOP_UP_QUEUE", daily_limit: "", target_open_queue: "50", max_open_queue: "60", working_days: [1, 2, 3, 4, 5], campaign_id: "", campaign_priority: "100", effective_to: "" };

// Assignment quota and compensation stay separate: this page controls workload only; earnings come from completed reviews.
export default function SmeWorkforcePage() {
  const [rows, setRows] = useState<Row[]>([]), [reviewers, setReviewers] = useState<Reviewer[]>([]), [policies, setPolicies] = useState<Policy[]>([]), [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [filters, setFilters] = useState({ market_id: "", subject: "", campaign_id: "", reviewer_id: "", status: "" }), [run, setRun] = useState<RunResult | null>(null), [policy, setPolicy] = useState(emptyPolicy);
  const [allocation, setAllocation] = useState({ campaign_id: "", total: "" }), [reassignTo, setReassignTo] = useState<Record<string, string>>({}), [limits, setLimits] = useState<Record<string, { daily: string; target: string; max: string }>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const act = useCallback(async (work: () => Promise<unknown>, message?: string) => { setBusy(true); setError(""); setNotice(""); try { await work(); if (message) setNotice(message); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }, []);
  const load = useCallback(async () => {
    const [dashboard, people, list] = await Promise.all([workforce<Row[]>("dashboard", filters), workforce<Reviewer[]>("reviewers"), workforce<Policy[]>("policies")]);
    setRows(dashboard); setReviewers(people); setPolicies(list); setCampaigns(await factory<Campaign[]>("list").catch(() => []));
  }, [filters]);
  useEffect(() => { void act(load); }, [act, load]);
  const markets = [...new Map(reviewers.flatMap((r) => r.domains.filter((d) => d.market_id).map((d) => [d.market_id!, d.market!]))).entries()];
  const subjects = [...new Set(reviewers.flatMap((r) => r.domains.map((d) => d.subject)))].sort();
  const scheduler = (dry: boolean) => act(async () => { setRun(await workforce<RunResult>("run_scheduler", { dry_run: dry, campaign_id: filters.campaign_id || undefined })); await load(); }, dry ? "Preview only: nothing was assigned." : "Scheduler run complete.");
  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    await act(async () => {
      const n = (v: string) => v === "" ? null : Number(v);
      await workforce("save_policy", { ...policy, market_id: policy.market_id || null, subject_code: policy.subject_code || null, campaign_id: policy.campaign_id || null, effective_to: policy.effective_to || null,
        grade_codes: policy.grade_codes.split(",").map((g) => g.trim()).filter(Boolean), daily_limit: n(policy.daily_limit), target_open_queue: n(policy.target_open_queue), max_open_queue: n(policy.max_open_queue), campaign_priority: Number(policy.campaign_priority) });
      setPolicy(emptyPolicy); await load();
    }, "Workload policy saved.");
  }

  return <>
    <div className="qb-page-head"><div><h1>SME Workforce</h1><p>Workload policies, the assignment scheduler and reviewer capacity. Assignment never creates earnings; only completed eligible reviews do.</p></div></div>
    {error && <p className="qb-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}

    <section className="qb-card"><h2>Scheduler</h2>
      <p className="qb-muted">Finds eligible unassigned questions and assigns them within each reviewer&apos;s authorized domain, daily limit, target queue, maximum queue, working days and campaign priority. Re-running is safe: a full queue receives nothing.</p>
      <div className="qb-content-filters"><button className="qb-btn secondary" disabled={busy} onClick={() => scheduler(true)}>Preview assignment</button><button className="qb-btn" disabled={busy} onClick={() => scheduler(false)}>Run scheduler now</button></div>
      {run && <div className="qb-table-wrap"><p>{run.dry_run ? "Preview" : "Assigned"}: {run.dry_run ? run.policies.reduce((s, p) => s + p.eligible, 0) : run.assigned}</p><table className="qb-table"><thead><tr><th>Reviewer</th><th>Mode</th><th>Kind</th><th>Outstanding before</th><th>Capacity</th><th>Eligible</th><th>Assigned</th><th>Note</th></tr></thead>
        <tbody>{run.policies.map((p, i) => <tr key={i}><td>{p.reviewer}</td><td>{p.mode}</td><td>{p.kind}</td><td>{p.outstanding_before}</td><td>{p.capacity}</td><td>{p.eligible}</td><td>{p.assigned}</td><td>{[p.reason, ...p.errors].filter(Boolean).join(", ") || "-"}</td></tr>)}</tbody></table></div>}
    </section>

    <section className="qb-card"><h2>Workforce dashboard</h2>
      <div className="qb-content-filters">
        <label>Market<select value={filters.market_id} onChange={(e) => setFilters({ ...filters, market_id: e.target.value })}><option value="">All</option>{markets.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Subject<select value={filters.subject} onChange={(e) => setFilters({ ...filters, subject: e.target.value })}><option value="">All</option>{subjects.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Campaign<select value={filters.campaign_id} onChange={(e) => setFilters({ ...filters, campaign_id: e.target.value })}><option value="">All</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Reviewer<select value={filters.reviewer_id} onChange={(e) => setFilters({ ...filters, reviewer_id: e.target.value })}><option value="">All</option>{reviewers.map((r) => <option key={r.reviewer_id} value={r.reviewer_id}>{r.name}</option>)}</select></label>
        <label>Status<select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">All</option><option value="active">Active</option><option value="paused">Paused</option><option value="no_policy">No policy</option></select></label>
      </div>
      <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Reviewer</th><th>Market</th><th>Subject</th><th>Daily limit</th><th>Target queue</th><th>Assigned today</th><th>Outstanding</th><th>Completed today</th><th>Completed month</th>
        <th>Approved</th><th>Revisions</th><th>Rejected</th><th>QA reversals</th><th>Avg review</th><th>Compensation unresolved</th><th>Payable</th><th>Paid</th><th>Actions</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.reviewer_id}>
          <td>{r.reviewer}<div className="qb-small qb-muted">{r.status}{r.mode ? ` · ${r.mode}` : ""}</div></td><td>{r.market}</td><td>{r.subject}</td><td>{r.daily_limit ?? "-"}</td><td>{r.target_queue ?? "-"}</td><td>{r.assigned_today}</td><td>{r.outstanding}</td><td>{r.completed_today}</td>
          <td>{r.month.completed}</td><td>{r.month.approved}</td><td>{r.month.revisions} ({r.month.revision_rate}%)</td><td>{r.month.rejected}</td><td>{r.month.qa_reversals} ({r.month.qa_reversal_rate}%)</td>
          <td>{r.month.average_review_seconds == null ? "-" : `${Math.round(r.month.average_review_seconds / 60)} min`}</td><td>{r.compensation_unresolved}</td><td>{money(r.payable)}{Object.keys(r.pending_qa ?? {}).length ? <div className="qb-small qb-muted">pending QA {money(r.pending_qa)}</div> : null}</td><td>{money(r.paid)}</td>
          <td><div className="qb-content-filters">
            <button className="qb-btn secondary" disabled={busy || !r.policy_id} onClick={() => act(async () => { await workforce("pause_reviewer", { reviewer_id: r.reviewer_id, paused: r.status !== "paused", reason: r.status === "paused" ? "Resumed by admin" : "Paused by admin" }); await load(); }, r.status === "paused" ? "Assignments resumed." : "Assignments paused.")}>{r.status === "paused" ? "Resume" : "Pause"}</button>
            <label className="qb-small">Reassign outstanding to<select value={reassignTo[r.reviewer_id] ?? ""} onChange={(e) => setReassignTo({ ...reassignTo, [r.reviewer_id]: e.target.value })}><option value="">Return to pool</option>{reviewers.filter((x) => x.reviewer_id !== r.reviewer_id).map((x) => <option key={x.reviewer_id} value={x.reviewer_id}>{x.name}</option>)}</select></label>
            <button className="qb-btn secondary" disabled={busy || !r.outstanding} onClick={() => window.confirm(`Release ${r.outstanding} outstanding review(s) from ${r.reviewer}?`) && act(async () => { const res = await workforce<{ released: number }>("reassign", { reviewer_id: r.reviewer_id, all_outstanding: true, to_reviewer_id: reassignTo[r.reviewer_id] || undefined, reason: "Workload rebalanced by admin" }); await load(); setNotice(`${res.released} review(s) released.`); })}>Reassign</button>
            {r.policy_id && <>
              <label className="qb-small">Daily<input type="number" min={0} style={{ width: "4.5rem" }} value={limits[r.policy_id]?.daily ?? String(r.daily_limit ?? "")} onChange={(e) => setLimits({ ...limits, [r.policy_id!]: { daily: e.target.value, target: limits[r.policy_id!]?.target ?? String(r.target_queue ?? ""), max: limits[r.policy_id!]?.max ?? String(r.max_queue ?? "") } })}/></label>
              <label className="qb-small">Target<input type="number" min={0} style={{ width: "4.5rem" }} value={limits[r.policy_id]?.target ?? String(r.target_queue ?? "")} onChange={(e) => setLimits({ ...limits, [r.policy_id!]: { daily: limits[r.policy_id!]?.daily ?? String(r.daily_limit ?? ""), target: e.target.value, max: limits[r.policy_id!]?.max ?? String(r.max_queue ?? "") } })}/></label>
              <label className="qb-small">Max<input type="number" min={0} style={{ width: "4.5rem" }} value={limits[r.policy_id]?.max ?? String(r.max_queue ?? "")} onChange={(e) => setLimits({ ...limits, [r.policy_id!]: { daily: limits[r.policy_id!]?.daily ?? String(r.daily_limit ?? ""), target: limits[r.policy_id!]?.target ?? String(r.target_queue ?? ""), max: e.target.value } })}/></label>
              <button className="qb-btn secondary" disabled={busy || !limits[r.policy_id]} onClick={() => act(async () => { const l = limits[r.policy_id!]; await workforce("set_limits", { policy_id: r.policy_id, daily_limit: l.daily === "" ? null : Number(l.daily), target_open_queue: l.target === "" ? null : Number(l.target), max_open_queue: Number(l.max) }); await load(); }, "Limits changed.")}>Save limits</button>
            </>}
          </div></td></tr>)}</tbody></table>
        {!rows.length && <p className="qb-muted">No reviewers match these filters.</p>}</div>
    </section>

    <section className="qb-card"><h2>Workload policies</h2>
      <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Reviewer</th><th>Scope</th><th>Mode</th><th>Daily</th><th>Target</th><th>Max</th><th>Days</th><th>Quota</th><th>Capacity now</th></tr></thead>
        <tbody>{policies.map((p) => <tr key={p.id}><td>{p.reviewer}{p.paused && <div className="qb-small qb-muted">paused</div>}</td><td>{p.market ?? "All markets"} · {p.subject_code ?? "All subjects"} · {p.review_kind}</td><td>{p.assignment_mode}</td><td>{p.daily_limit ?? "-"}</td><td>{p.target_open_queue ?? "-"}</td><td>{p.max_open_queue}</td>
          <td>{p.working_days.map((d) => DAYS[d - 1]).join(" ")}</td><td>{p.allocation_quota ?? "-"}</td><td>{p.state ? `${p.state.capacity}${p.state.reason ? ` (${p.state.reason})` : ""}` : "-"}</td></tr>)}</tbody></table></div>
      <h3>Add or update a policy (Super Admin)</h3>
      <form className="qb-form" onSubmit={savePolicy}><div className="qb-content-filters">
        <label>Reviewer<select value={policy.reviewer_id} onChange={(e) => setPolicy({ ...policy, reviewer_id: e.target.value })} required><option value="">Select reviewer</option>{reviewers.map((r) => <option key={r.reviewer_id} value={r.reviewer_id}>{r.name} ({r.domains.map((d) => `${d.subject}/${d.market ?? "all"}`).join(", ")})</option>)}</select></label>
        <label>Market<select value={policy.market_id} onChange={(e) => setPolicy({ ...policy, market_id: e.target.value })}><option value="">Any authorized</option>{markets.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Subject<select value={policy.subject_code} onChange={(e) => setPolicy({ ...policy, subject_code: e.target.value })}><option value="">Any authorized</option>{subjects.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Grades (comma-separated)<input value={policy.grade_codes} onChange={(e) => setPolicy({ ...policy, grade_codes: e.target.value })}/></label>
        <label>Review kind<select value={policy.review_kind} onChange={(e) => setPolicy({ ...policy, review_kind: e.target.value })}><option value="primary">Primary</option><option value="senior">Senior</option></select></label>
        <label>Assignment mode<select value={policy.assignment_mode} onChange={(e) => setPolicy({ ...policy, assignment_mode: e.target.value })}><option value="TOP_UP_QUEUE">Top up queue (recommended)</option><option value="FIXED_DAILY">Fixed daily</option><option value="CAMPAIGN_ALLOCATION">Campaign allocation</option></select></label>
        <label>Daily limit<input type="number" min={0} value={policy.daily_limit} onChange={(e) => setPolicy({ ...policy, daily_limit: e.target.value })} required={policy.assignment_mode === "FIXED_DAILY"}/></label>
        <label>Target open queue<input type="number" min={0} value={policy.target_open_queue} onChange={(e) => setPolicy({ ...policy, target_open_queue: e.target.value })} required={policy.assignment_mode === "TOP_UP_QUEUE"}/></label>
        <label>Maximum open queue<input type="number" min={0} value={policy.max_open_queue} onChange={(e) => setPolicy({ ...policy, max_open_queue: e.target.value })} required/></label>
        <label>Campaign<select value={policy.campaign_id} onChange={(e) => setPolicy({ ...policy, campaign_id: e.target.value })} required={policy.assignment_mode === "CAMPAIGN_ALLOCATION"}><option value="">Any campaign</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Campaign priority<input type="number" min={1} max={1000} value={policy.campaign_priority} onChange={(e) => setPolicy({ ...policy, campaign_priority: e.target.value })}/></label>
        <label>Effective until<input type="datetime-local" value={policy.effective_to} onChange={(e) => setPolicy({ ...policy, effective_to: e.target.value })}/></label>
      </div>
      <fieldset><legend>Working days</legend>{DAYS.map((d, i) => <label key={d}><input type="checkbox" checked={policy.working_days.includes(i + 1)} onChange={() => setPolicy({ ...policy, working_days: policy.working_days.includes(i + 1) ? policy.working_days.filter((x) => x !== i + 1) : [...policy.working_days, i + 1].sort() })}/>{d}</label>)}</fieldset>
      <button className="qb-btn" disabled={busy}>Save policy</button></form>
    </section>

    <section className="qb-card"><h2>Campaign allocation</h2>
      <p className="qb-muted">Splits a total across the campaign&apos;s CAMPAIGN_ALLOCATION policies in proportion to each reviewer&apos;s configured capacity.</p>
      <div className="qb-content-filters">
        <label>Campaign<select value={allocation.campaign_id} onChange={(e) => setAllocation({ ...allocation, campaign_id: e.target.value })}><option value="">Select campaign</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Questions to allocate<input type="number" min={0} value={allocation.total} onChange={(e) => setAllocation({ ...allocation, total: e.target.value })}/></label>
        <label>Campaign priority<input type="number" min={1} max={1000} defaultValue={100} onBlur={(e) => allocation.campaign_id && act(() => workforce("set_campaign_priority", { campaign_id: allocation.campaign_id, priority: Number(e.target.value) }), "Campaign priority changed.")}/></label>
        <button className="qb-btn secondary" disabled={busy || !allocation.campaign_id || allocation.total === ""} onClick={() => act(async () => { const shares = await workforce<Record<string, number>>("allocate", { campaign_id: allocation.campaign_id, total: Number(allocation.total) }); await load(); setNotice(`Allocated across ${Object.keys(shares).length} policy(ies).`); })}>Allocate</button>
      </div>
    </section>
  </>;
}
