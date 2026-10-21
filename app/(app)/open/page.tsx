import Link from "next/link";
import { getLibraryStats, listPublicChallenges } from "@/lib/challenges/server";
import { CONTENT_TYPES } from "@/lib/challenges/content-types";
import { CHALLENGE_CATEGORIES, FORMATS, formatDuration, type Format } from "@/lib/challenges/types";
import LogoImage from "@/components/challenges/LogoImage";

export const dynamic = "force-dynamic";

const label = (id: string) => CHALLENGE_CATEGORIES.find((c) => c.id === id)?.label ?? id;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null);

// What is open to join, inside the signed-in app: the same list the public site shows, but every link goes straight to the play page, so nobody is asked to sign in again.
export default async function OpenPage({ searchParams }: { searchParams: Promise<{ format?: string }> }) {
  const format: Format = (await searchParams).format === "competition" ? "COMPETITION" : "CHALLENGE", f = FORMATS[format];
  const [items, stats] = await Promise.all([listPublicChallenges(format), getLibraryStats()]);
  const library = stats.documents > 0 ? CONTENT_TYPES.filter((t) => stats.by_type[t.id]).map((t) => `${stats.by_type[t.id]} ${t.plural}`).join(" · ") : "";
  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>{format === "COMPETITION" ? "Open competitions" : "Open challenges"}</h1>
          <p>{format === "COMPETITION" ? "Take part in rounds. The best players go through to the next round until a winner is found." : "Timed quizzes anyone can join. Every answer is scored on our servers, so the leaderboard is fair."}</p>
        </div>
        <nav aria-label="Choose a kind" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className={`qb-btn${format === "CHALLENGE" ? "" : " qb-btn-secondary"}`} href="/open">Challenges</Link>
          <Link className={`qb-btn${format === "COMPETITION" ? "" : " qb-btn-secondary"}`} href="/open?format=competition">Competitions</Link>
          <Link className="qb-btn qb-btn-secondary" href="/creator">Create one</Link>
        </nav>
      </div>
      {library && <p className="qb-muted" style={{ marginBottom: 12 }}><strong>On QuizBox now:</strong> {library}. Read the material, then take the quiz.</p>}
      {items.length === 0 ? (
        <div className="qb-card">
          <h2>{format === "COMPETITION" ? "No open competitions right now" : "No open challenges right now"}</h2>
          <p className="qb-muted">New ones appear here when they go live. You can run your own and share the link: <Link className="qb-link" href="/creator">Create and share</Link>.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
          {items.map((c) => (
            <article key={c.slug} className="qb-card" style={{ display: "grid", gap: 6, alignContent: "start", minWidth: 0 }}>
              {c.brand?.logo && <LogoImage src={c.brand.logo} width={48} height={48} style={{ objectFit: "contain", borderRadius: 8 }} />}
              <p className="qb-overline" style={{ margin: 0 }}>{c.brand?.organiser_name ? `${c.brand.organiser_name} · ` : ""}{label(c.category)}</p>
              <h2 style={{ margin: 0, overflowWrap: "anywhere" }}><Link className="qb-link" href={`/play/${c.slug}`}>{c.title}</Link></h2>
              {c.summary && <p className="qb-muted" style={{ margin: 0 }}>{c.summary}</p>}
              <p className="qb-muted qb-small" style={{ margin: 0 }}>{format === "COMPETITION" && (c.stage_count ?? 1) > 1 ? `${c.stage_count} rounds · ` : ""}{c.question_count} questions · {formatDuration(c.time_limit_seconds * 1000)} · {c.participants} played{c.ends_at ? ` · closes ${when(c.ends_at)}` : ""}</p>
              <Link className="qb-btn" style={{ justifySelf: "start" }} href={`/play/${c.slug}`}>{format === "COMPETITION" ? "Join" : "Play"} this {f.noun}</Link>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
