import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import { getPublicChallenge, getPublicLeaderboard } from "@/lib/challenges/server";
import { CHALLENGE_CATEGORIES, formatDuration } from "@/lib/challenges/types";
import { SITE_URL } from "@/lib/site";

export const revalidate = 30;
type Props = { params: Promise<{ slug: string }> };

// Link previews and search results only for public and unlisted challenges that are open or finished; private ones are never indexed or described.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const c = await getPublicChallenge(slug);
  if (!c || c.private) return { title: "Challenge | QuizBox", robots: { index: false, follow: false } };
  const url = `${SITE_URL}/challenges/${c.slug}`;
  const description = c.summary || `${c.question_count} questions, ${Math.round(c.time_limit_seconds / 60)} minutes. Play this QuizBox challenge.`;
  return {
    title: `${c.title} | QuizBox Challenges`, description, alternates: { canonical: url },
    robots: c.visibility === "PUBLIC" ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title: c.title, description, url, type: "website", siteName: "QuizBox" },
    twitter: { card: "summary", title: c.title, description },
  };
}

export default async function ChallengePage({ params }: Props) {
  const { slug } = await params;
  const c = await getPublicChallenge(slug);
  if (!c) notFound();
  const board = c.private ? [] : await getPublicLeaderboard(slug);
  const category = CHALLENGE_CATEGORIES.find((x) => x.id === c.category)?.label;
  const play = `/play/${c.slug}`;
  return (
    <PublicShell>
      <PageIntro crumb="Challenges" title={c.title} lead={c.private ? "This challenge is private. Sign in and enter the access code you were given." : c.summary} />
      <section className="qbp-wrap" style={{ paddingBottom: 64, display: "grid", gap: 24 }} data-qb-section="challenge">
        <div className="qbp-card" style={{ maxWidth: 820 }}>
          {!c.private && <p className="qbp-meta">{category} · {c.question_count} questions · {formatDuration(c.time_limit_seconds * 1000)} · {c.max_attempts} attempt{c.max_attempts === 1 ? "" : "s"} · {c.participants} played</p>}
          {c.reward_text && <p><strong>Prize or recognition:</strong> {c.reward_text}</p>}
          {c.live ? (
            <p><Link className="qbp-btn" href={play}>Play now</Link> <span className="qbp-meta">You will be asked to sign in or create an account.</span></p>
          ) : (
            <p className="qbp-meta">{c.status === "COMPLETED" ? "This challenge has finished." : c.status === "PAUSED" ? "This challenge is paused." : "This challenge is not open right now."}</p>
          )}
        </div>
        {!c.private && (
          <div className="qbp-card" style={{ maxWidth: 820 }}>
            <h2 className="qbp-h3">Leaderboard</h2>
            {board.length === 0 ? <p className="qbp-meta">No finished attempts yet. Be the first.</p> : (
              <ol className="qbp-list" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
                {board.map((r) => <li key={`${r.rank}-${r.name}`}><strong>{r.rank}.</strong> {r.name} <span className="qbp-meta">{r.score}/{r.max_score} in {formatDuration(r.duration_ms)}</span></li>)}
              </ol>
            )}
          </div>
        )}
      </section>
    </PublicShell>
  );
}
