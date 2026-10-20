"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { adminOverview, createChallenge, myCampaigns } from "@/lib/api/challenges";
import { CHALLENGE_CATEGORIES, FORMATS, type Format, type MyCampaign } from "@/lib/challenges/types";
import { humanize } from "@/lib/format";

// Console for challenges and competitions: your campaigns, and a short form to start a new one. A challenge is one timed round; a competition has rounds that pass players on.
// Questions are added on the next screen. Anyone signed in can create and share one.
function CreatorConsole() {
  const router = useRouter();
  const format: Format = useSearchParams().get("format") === "competition" ? "COMPETITION" : "CHALLENGE", fmt = FORMATS[format], Noun = fmt.noun.charAt(0).toUpperCase() + fmt.noun.slice(1);
  const [rows, setRows] = useState<MyCampaign[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof adminOverview>> | null>(null);
  const [f, setF] = useState({ title: "", summary: "", category: "general_knowledge", visibility: "PUBLIC", questionCount: 10, timeLimitSeconds: 600, maxAttempts: 1, startsAt: "", endsAt: "", rewardText: "", accessCode: "" });
  useEffect(() => { myCampaigns().then(setRows).catch((e) => { setError(e.message); setRows([]); }); }, []);
  useEffect(() => { adminOverview().then(setOverview).catch(() => setOverview(null)); }, []);   // only admins get an answer
  const mine = (rows ?? []).filter((r) => (r.format ?? "CHALLENGE") === format);
  const set = (k: string, v: string | number) => setF((x) => ({ ...x, [k]: v }));

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const r = await createChallenge({ ...f, format, startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null, endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null });
      router.push(`/creator/${r.id}`);
    } catch (err: any) { setError(err.message); setBusy(false); }
  }

  return (
    <>
      <div className="qb-page-head"><div><h1>{Noun}s</h1><p>{format === "COMPETITION" ? "Run a competition with rounds: the best players go through to the next round. Share the link, aim it at a class or school, or keep it private with an access code." : "Create a timed quiz anyone can join, share the link, or keep it private with an access code. Answers are scored on the server."}</p></div>
        <div><Link className="qb-link" href={format === "COMPETITION" ? "/creator" : "/creator?format=competition"}>{format === "COMPETITION" ? "Go to challenges" : "Go to competitions"}</Link></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {overview && (
        <div className="qb-card">
          <h2>Across QuizBox</h2>
          <p>{Object.entries(overview.campaigns).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(" · ") || "No challenges yet"}. {overview.players_30d} players and {overview.attempts_30d} attempts in the last 30 days. {overview.awards_pending} prizes waiting to be delivered.</p>
          {overview.top.length > 0 && <ol className="qb-list">{overview.top.map((c) => <li key={c.slug}><Link className="qb-link" href={`/challenges/${c.slug}`}>{c.title}</Link> <span className="qb-muted">{c.status.toLowerCase()} · {c.players} players</span></li>)}</ol>}
        </div>
      )}
      <div className="qb-card">
        <h2>Your {fmt.plural}</h2>
        {rows === null ? <p className="qb-muted">Loading…</p> : mine.length === 0 ? <p className="qb-muted">Nothing yet. Start one below.</p> : (
          <table className="qb-table"><thead><tr><th>Title</th><th>Status</th><th>Who can join</th><th>Questions</th><th>Played</th><th /></tr></thead><tbody>
            {mine.map((r) => <tr key={r.id}><td>{r.title}</td><td>{humanize(r.status)}</td><td>{r.has_audience ? "One class or school" : r.visibility === "PRIVATE" ? `Code ${r.access_code ?? ""}` : r.visibility === "UNLISTED" ? "Link only" : "Everyone"}</td>
              <td>{r.questions_loaded}/{r.question_count}</td><td>{r.participants}</td><td><Link className="qb-link" href={`/creator/${r.id}`}>Open</Link>{r.status === "LIVE" && <> · <Link className="qb-link" href={`${fmt.base}/${r.slug}`}>Public page</Link></>}</td></tr>)}
          </tbody></table>
        )}
      </div>
      <form className="qb-card qb-form" onSubmit={create}>
        <h2>New {fmt.noun}</h2>
        <label className="qb-field">Title<input required minLength={3} maxLength={120} value={f.title} onChange={(e) => set("title", e.target.value)} /></label>
        <label className="qb-field">Short description<textarea maxLength={500} value={f.summary} onChange={(e) => set("summary", e.target.value)} /></label>
        <div className="qb-grid cols-3">
          <label className="qb-field">Category<select value={f.category} onChange={(e) => set("category", e.target.value)}>{CHALLENGE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
          <label className="qb-field">Who can join<select value={f.visibility} onChange={(e) => set("visibility", e.target.value)}><option value="PUBLIC">Everyone (listed)</option><option value="UNLISTED">Anyone with the link</option><option value="PRIVATE">Access code only</option></select></label>
          {f.visibility === "PRIVATE" && <label className="qb-field">Access code<input required minLength={4} maxLength={24} value={f.accessCode} onChange={(e) => set("accessCode", e.target.value)} /></label>}
        </div>
        <div className="qb-grid cols-3">
          <label className="qb-field">{format === "COMPETITION" ? "Questions in the first round" : "Questions each player gets"}<input type="number" min={3} max={100} value={f.questionCount} onChange={(e) => set("questionCount", Number(e.target.value))} /></label>
          <label className="qb-field">Time limit (minutes)<input type="number" min={1} max={120} value={Math.round(f.timeLimitSeconds / 60)} onChange={(e) => set("timeLimitSeconds", Number(e.target.value) * 60)} /></label>
          <label className="qb-field">Attempts per player<input type="number" min={1} max={10} value={f.maxAttempts} onChange={(e) => set("maxAttempts", Number(e.target.value))} /></label>
        </div>
        <div className="qb-grid cols-3">
          <label className="qb-field">Opens (optional)<input type="datetime-local" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></label>
          <label className="qb-field">Closes (optional)<input type="datetime-local" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></label>
          <label className="qb-field">Prize or recognition (optional)<input maxLength={300} value={f.rewardText} onChange={(e) => set("rewardText", e.target.value)} /></label>
        </div>
        <button className="qb-btn" disabled={busy}>{busy ? "Creating…" : format === "COMPETITION" ? "Create and set up rounds" : "Create and add questions"}</button>
      </form>
    </>
  );
}

export default function CreatorPage() { return <Suspense fallback={<div className="qb-card" role="status">Loading…</div>}><CreatorConsole /></Suspense>; }
