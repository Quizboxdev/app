"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { adminOverview, cloneCampaign, myCampaigns } from "@/lib/api/challenges";
import { FORMATS, formatOf, type Format, type MyCampaign } from "@/lib/challenges/types";
import { humanize } from "@/lib/format";

// My challenges and My competitions. Start a new one with the guided studio, find the ones you are running, and keep the ones that finished: any of them can be used as a template and
// run again for a different audience (questions, rounds, prizes, look and material are copied; the audience and dates are not).
function Console() {
  const router = useRouter();
  const format: Format = useSearchParams().get("format") === "competition" ? "COMPETITION" : "CHALLENGE", fmt = FORMATS[format], Noun = fmt.noun.charAt(0).toUpperCase() + fmt.noun.slice(1);
  const [rows, setRows] = useState<MyCampaign[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(""), [overview, setOverview] = useState<Awaited<ReturnType<typeof adminOverview>> | null>(null);
  useEffect(() => { myCampaigns().then(setRows).catch((e) => { setError(e.message); setRows([]); }); }, []);
  useEffect(() => { adminOverview().then(setOverview).catch(() => setOverview(null)); }, []);   // only admins get an answer
  const mine = (rows ?? []).filter((r) => formatOf(r.format) === format);
  const current = mine.filter((r) => !["COMPLETED", "ARCHIVED"].includes(r.status)), past = mine.filter((r) => ["COMPLETED", "ARCHIVED"].includes(r.status));

  async function reuse(r: MyCampaign) {
    setBusy(r.id); setError("");
    try { const c = await cloneCampaign(r.id); router.push(`/creator/${c.id}`); } catch (e: any) { setError(e.message); setBusy(""); }
  }
  const who = (r: MyCampaign) => (r.has_audience ? "One class or school" : r.visibility === "PRIVATE" ? `Code ${r.access_code ?? ""}` : r.visibility === "UNLISTED" ? "Link only" : "Everyone");
  const table = (list: MyCampaign[], reusable: boolean) => (
    <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Title</th><th>Status</th><th>Who can join</th><th>Questions</th><th>Played</th><th /></tr></thead><tbody>
      {list.map((r) => <tr key={r.id}>
        <td>{r.title}{r.cloned_from ? <span className="qb-muted qb-small"> · from a template</span> : null}</td><td>{humanize(r.status)}</td><td>{who(r)}</td>
        <td>{r.questions_loaded}/{r.question_count}</td><td>{r.participants}</td>
        <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="qb-link" href={`/creator/${r.id}`}>Open</Link>
          {r.status === "LIVE" && <Link className="qb-link" href={`${fmt.base}/${r.slug}`}>Public page</Link>}
          {(reusable || r.status === "LIVE" || r.status === "PAUSED") && <button className="qb-link-btn" disabled={busy === r.id} onClick={() => void reuse(r)}>{busy === r.id ? "Copying…" : "Use as template"}</button>}
        </td></tr>)}
    </tbody></table></div>);

  return (
    <>
      <div className="qb-page-head"><div><h1>My {fmt.plural}</h1><p>{format === "COMPETITION" ? "Run a competition with rounds: the best players go through to the next round. Share the link, aim it at a class or school, or keep it private with an access code." : "Create a timed quiz anyone can join, share the link, or keep it private with an access code. Answers are scored on the server."}</p></div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Link className="qb-btn" href={`/creator/new?format=${format.toLowerCase()}`}>Start a {fmt.noun}</Link>
          <Link className="qb-link" href={format === "COMPETITION" ? "/creator" : "/creator?format=competition"}>{format === "COMPETITION" ? "Go to challenges" : "Go to competitions"}</Link></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {overview && (
        <div className="qb-card">
          <h2>Across QuizBox</h2>
          <p>{Object.entries(overview.campaigns).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(" · ") || "Nothing yet"}. {overview.players_30d} players and {overview.attempts_30d} attempts in the last 30 days. {overview.awards_pending} prizes waiting to be delivered.</p>
          {overview.top.length > 0 && <ol className="qb-list">{overview.top.map((c) => <li key={c.slug}><Link className="qb-link" href={`/challenges/${c.slug}`}>{c.title}</Link> <span className="qb-muted">{c.status.toLowerCase()} · {c.players} players</span></li>)}</ol>}
        </div>
      )}
      <div className="qb-card">
        <h2>Running and drafts</h2>
        {rows === null ? <p className="qb-muted">Loading…</p> : current.length === 0 ? <div className="qb-empty"><strong>No {fmt.plural} yet</strong>Press &ldquo;Start a {fmt.noun}&rdquo;. It takes a few minutes, and we guide you through each step.</div> : table(current, false)}
      </div>
      <div className="qb-card">
        <h2>Past {fmt.plural}</h2>
        <p className="qb-muted">Finished {fmt.plural} are kept here. Use one as a template to run it again for a different audience: the questions, rounds, prizes, look and material come with it.</p>
        {rows === null ? null : past.length === 0 ? <p className="qb-muted">None finished yet.</p> : table(past, true)}
      </div>
      <p className="qb-muted qb-small">{Noun}s you start are saved as drafts, so you can finish later.</p>
    </>
  );
}

export default function CreatorPage() { return <Suspense fallback={<div className="qb-card" role="status">Loading…</div>}><Console /></Suspense>; }
