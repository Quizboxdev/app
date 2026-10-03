"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, UserPlus, Check, X, Layers, Send } from "lucide-react";
import { sponsorWorkspaceRequest as call } from "@/lib/api/sponsor-workspace";

type CandidateRow = { id: string; status: string; question_id: string | null; payload: { stem: string; difficulty: string; subject: string } };
type BankRow = { candidate_id: string; included: boolean; position: number; question_version_id: string };
type Analytics = { registrations: number; attempts_started: number; attempts_completed: number; completion_rate: number; average_score: number | null; score_distribution: unknown[]; market_distribution: unknown[]; institution_distribution: unknown[]; question_performance: unknown[]; ranking_summary: unknown[] };

export default function SponsorCompetitionDelivery({ sponsor, competition, writable }: { sponsor: string; competition: string; writable: boolean }) {
  const [candidates, setCandidates] = useState<CandidateRow[]>([]), [bank, setBank] = useState<BankRow[]>([]);
  const [issues, setIssues] = useState<string[]>([]), [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const [rows, included, gate, stats] = await Promise.all([call<CandidateRow[]>("candidates", sponsor, { competition_id: competition }), call<BankRow[]>("bank", sponsor, { competition_id: competition }), call<{ blockers: string[] }>("publication_check", sponsor, { competition_id: competition }), call<Analytics>("analytics", sponsor, { competition_id: competition })]);
    setCandidates(rows); setBank(included); setIssues(gate.blockers); setAnalytics(stats);
  }, [sponsor, competition]);
  useEffect(() => { void load().catch(e => setError(e.message)); }, [load]);
  // Keep a candidate's existing bank position; new inclusions take the next free position (list order is not stable).
  const bankPosition = (candidateId: string) => bank.find(b => b.candidate_id === candidateId)?.position ?? (bank.length ? Math.max(...bank.map(b => b.position)) + 1 : 0);
  async function perform(work: () => Promise<void>) { if (busy) return; setBusy(true); setError(""); setNotice(""); try { await work(); await load(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  return <section>
    <div className="qb-page-head"><h3>Review and publication</h3><button title="Refresh competition bank" aria-label="Refresh competition bank" disabled={busy} onClick={() => void perform(load)}><RefreshCw size={16}/></button></div>
    {error && <p className="qb-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Question</th><th>Domain</th><th>Difficulty</th><th>Review</th><th>Bank</th><th>Actions</th></tr></thead><tbody>{candidates.map((row) => {
      const included = bank.find(b => b.candidate_id === row.id)?.included;
      return <tr key={row.id}><td>{row.payload.stem}</td><td>{row.payload.subject}</td><td>{row.payload.difficulty}</td><td>{row.status}</td><td>{included ? "Included" : "Excluded"}</td><td>
        {row.status === "APPROVED" && <button disabled={busy || !writable} title={included ? "Exclude from bank" : "Materialize and include"} onClick={() => void perform(async () => { await call("include_bank", sponsor, { competition_id: competition, candidate_id: row.id, included: !included, position: bankPosition(row.id) }); })}>{included ? <X size={16}/> : <Check size={16}/>}</button>}
        {!row.question_id && ["GENERATED", "ASSIGNED_FOR_REVIEW"].includes(row.status) && <form onSubmit={event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); void perform(async () => { await call("assign_candidate", sponsor, { ...data, competition_id: competition, candidate_id: row.id }); setNotice("Review assigned."); }); }}><fieldset disabled={busy || !writable} className="qb-content-filters"><label>Reviewer UUID<input name="reviewer_id" required/></label><label>Domain assignment UUID<input name="domain_id" required/></label><label>Review level<select name="kind"><option value="primary">Primary</option><option value="senior">Senior QA</option></select></label><button title="Assign candidate review" aria-label="Assign candidate review"><UserPlus size={16}/></button></fieldset></form>}
      </td></tr>;
    })}</tbody></table></div>
    <ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
    <div className="qb-content-filters"><button disabled={busy || !writable} onClick={() => void perform(async () => { const result = await call<{ blockers?: string[]; snapshot_id?: string }>("create_snapshot", sponsor, { competition_id: competition }); if (result.blockers?.length) setError(result.blockers.join("; ")); else setNotice("Immutable snapshot created."); })}><Layers size={16}/>Create snapshot</button><button disabled={busy || !writable || issues.length > 0} onClick={() => void perform(async () => { const result = await call<{ published: boolean; blockers: string[] }>("publish", sponsor, { competition_id: competition }); if (!result.published) setError(result.blockers.join("; ")); else setNotice("Competition published."); })}><Send size={16}/>Publish</button><Link href={`/competition/participate/${competition}`}>Participant view</Link></div>
    {analytics && <><h3>Participation</h3><dl className="qb-content-filters">{["registrations", "attempts_started", "attempts_completed", "completion_rate", "average_score"].map(key => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{String(analytics[key as keyof Analytics] ?? "-")}</dd></div>)}</dl>{["score_distribution", "market_distribution", "institution_distribution", "question_performance", "ranking_summary"].map(key => <details key={key}><summary>{key.replaceAll("_", " ")}</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(analytics[key as keyof Analytics], null, 2)}</pre></details>)}</>}
    <CompetitionOperations sponsor={sponsor} competition={competition} writable={writable}/>
  </section>;
}


type Readiness = { status: string; published_version: number | null; publication_blockers: string[]; review: Record<string, number>; sources: Record<string, number> };
// Lifecycle operations around the unchanged engine: readiness, eligibility, immutable version, clone/close/archive.
function CompetitionOperations({ sponsor, competition, writable }: { sponsor: string; competition: string; writable: boolean }) {
  const [ready, setReady] = useState<Readiness | null>(null), [eligibility, setEligibility] = useState<Record<string, any> | null>(null), [version, setVersion] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = useCallback(async () => { setReady(await call<Readiness>("readiness", sponsor, { competition_id: competition })); setEligibility(await call("eligibility_summary", sponsor, { competition_id: competition })); }, [sponsor, competition]);
  useEffect(() => { void load().catch((e) => setError(e.message)); }, [load]);
  async function act(action: "clone_competition" | "close_competition" | "archive_competition", confirmText: string, done: string) {
    if (!window.confirm(confirmText)) return; setBusy(true); setError(""); setNotice("");
    try { await call(action, sponsor, { competition_id: competition }); setNotice(done); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!ready) return error ? <p className="qb-error" role="alert">{error}</p> : null;
  const r = ready.review, src = ready.sources;
  return <section aria-labelledby={`ops-${competition}`}><h3 id={`ops-${competition}`}>Readiness and operations</h3>
    {error && <p className="qb-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <dl className="qb-stat-list">
      <div><dt>Status</dt><dd>{ready.status}{ready.published_version ? ` · v${ready.published_version}` : ""}</dd></div>
      <div><dt>Publication</dt><dd>{ready.publication_blockers.length ? `${ready.publication_blockers.length} blocker(s)` : "Ready"}</dd></div>
      <div><dt>Review complete</dt><dd>{r.approved}/{r.candidates}{r.pending ? ` (${r.pending} pending)` : ""}</dd></div>
      <div><dt>Bank</dt><dd>{r.in_bank}/{r.required}</dd></div>
      <div><dt>Sources approved</dt><dd>{src.approved}/{src.total}</dd></div>
      <div><dt>Eligible registrations</dt><dd>{eligibility?.registered ?? 0}{eligibility?.ineligible ? ` (+${eligibility.ineligible} ineligible)` : ""}</dd></div>
    </dl>
    {ready.publication_blockers.length > 0 && <ul>{ready.publication_blockers.map((b) => <li key={b}>{b.replaceAll("_", " ").toLowerCase()}</li>)}</ul>}
    {(eligibility?.by_market ?? []).length > 0 && <p className="qb-muted">By market: {(eligibility?.by_market ?? []).map((m: any) => `${m.market} ${m.registrations}`).join(", ")}</p>}
    <div className="qb-content-filters">
      <button disabled={busy || !writable} onClick={() => void act("clone_competition", "Create a new draft from this configuration? Sources, questions and results are not copied.", "Draft copy created. Select it from the Draft list.")}>Clone</button>
      {ready.status === "PUBLISHED" && <button disabled={busy || !writable} onClick={() => void act("close_competition", "Close this competition now? No new registrations or attempts will be accepted.", "Competition closed.")}>Close now</button>}
      {ready.status !== "ARCHIVED" && <button disabled={busy || !writable} onClick={() => void act("archive_competition", "Archive this competition?", "Competition archived.")}>Archive</button>}
      {ready.published_version && <button disabled={busy} onClick={() => void (version ? setVersion(null) : call<Record<string, any>>("published_version", sponsor, { competition_id: competition }).then(setVersion).catch((e) => setError(e.message)))}>{version ? "Hide published version" : "View published version"}</button>}
    </div>
    {version && <div className="qb-card"><p>Version {version.version} · checksum {String(version.checksum).slice(0, 12)}… · {new Date(version.published_at).toLocaleString()}</p>
      <ol>{(version.questions ?? []).map((q: any) => <li key={q.version_id}>{q.content?.question_text ?? q.content?.stem ?? "Question"}</li>)}</ol></div>}
  </section>;
}

// Side-by-side comparison of this organization's competitions (server-aggregated).
export function CompetitionComparison({ sponsor }: { sponsor: string }) {
  const [rows, setRows] = useState<Array<Record<string, any>>>([]), [error, setError] = useState("");
  useEffect(() => { call<Array<Record<string, any>>>("competition_comparison", sponsor, {}).then(setRows).catch((e) => setError(e.message)); }, [sponsor]);
  if (error) return <p className="qb-error" role="alert">{error}</p>;
  if (!rows.length) return null;
  return <details><summary>Compare competitions ({rows.length})</summary><div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Competition</th><th>Scope</th><th>Status</th><th>Registered</th><th>Started</th><th>Completed</th><th>Average</th></tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}><td>{r.title}</td><td>{r.scope}</td><td>{r.status}</td><td>{r.registrations}</td><td>{r.started}</td><td>{r.completed}</td><td>{r.average_percentage === null ? "-" : `${r.average_percentage}%`}</td></tr>)}</tbody></table></div></details>;
}
