"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, UserPlus, RefreshCw } from "lucide-react";
import { sponsorWorkspaceRequest as call } from "@/lib/api/sponsor-workspace";
import { describeCode } from "@/lib/errors";
type Info = { competition_id: string; title: string; description: string; starts_at: string; ends_at: string; questions?: number; duration_seconds?: number; registration?: { eligible: boolean; status: string; eligibility_snapshot: { blockers: string[] } } | null };
type Result = { attempt_id: string; score: number; possible_score: number; percentage: number };
type Rank = { display_name: string; is_you: boolean; rank: number; score: number; duration_seconds: number };
export default function CompetitionParticipation({ competition }: { competition?: string }) {
  const [rows, setRows] = useState<Info[]>([]), [info, setInfo] = useState<Info | null>(null), [results, setResults] = useState<Result[]>([]), [ranks, setRanks] = useState<Rank[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""); const router = useRouter();
  const load = useCallback(async () => {
    if (!competition) { setRows(await call<Info[]>("discover")); return; }
    const current = await call<Info>("competition_info", null, { competition_id: competition }); setInfo(current);
    setRanks(await call<Rank[]>("leaderboard", null, { competition_id: competition }));
    if (current.registration?.eligible) setResults(await call<Result[]>("official_result", null, { competition_id: competition }));
  }, [competition]);
  useEffect(() => { void load().catch(cause => setError(cause.message)); }, [load]);
  async function perform(work: () => Promise<void>) { if (busy) return; setBusy(true); setError(""); try { await work(); await load(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  return <><div className="qb-page-head"><h1>{info?.title ?? "Published competitions"}</h1><button title="Refresh competitions" aria-label="Refresh competitions" disabled={busy} onClick={() => void perform(load)}><RefreshCw size={16}/></button></div>{error && <p className="qb-error" role="alert">{error}</p>}
    {!competition && rows.map(row => <div className="qb-row" key={row.competition_id}><Link href={`/competition/participate/${row.competition_id}`}>{row.title}</Link><span>{row.starts_at}</span></div>)}
    {info && <><p>{info.description}</p><dl className="qb-content-filters"><div><dt>Starts</dt><dd>{info.starts_at}</dd></div><div><dt>Ends</dt><dd>{info.ends_at}</dd></div><div><dt>Questions</dt><dd>{info.questions}</dd></div><div><dt>Duration</dt><dd>{info.duration_seconds}s</dd></div></dl>{info.registration?.eligibility_snapshot.blockers.map(issue => <p key={issue} className="qb-error">{describeCode(issue)}</p>)}<div className="qb-content-filters"><button disabled={busy || Boolean(info.registration)} onClick={() => void perform(async () => { await call("register", null, { competition_id: competition }); })}><UserPlus size={16}/>Register</button><button disabled={busy || !info.registration?.eligible} onClick={() => void perform(async () => { const result = await call<{ attempt_id: string }>("start_competition", null, { competition_id: competition }); router.push(`/competition/attempt/${result.attempt_id}`); })}><Play size={16}/>Start or resume</button></div>
      <h2>Official results</h2>{results.map(result => <div className="qb-row" key={result.attempt_id}><Link href={`/competition/results/${result.attempt_id}`}>{result.score} / {result.possible_score} ({result.percentage}%)</Link></div>)}
      <h2>Leaderboard</h2><div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Rank</th><th>Participant</th><th>Score</th><th>Seconds</th></tr></thead><tbody>{ranks.map(rank => <tr key={`${rank.rank}-${rank.display_name}`}><td>{rank.rank}</td><td>{rank.display_name}{rank.is_you && " (you)"}</td><td>{rank.score}</td><td>{rank.duration_seconds}</td></tr>)}</tbody></table></div>
    </>}
  </>;
}
