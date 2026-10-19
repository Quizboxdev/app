import type { Metadata } from "next";
import Link from "next/link";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import { listPublicChallenges } from "@/lib/challenges/server";
import { CHALLENGE_CATEGORIES, formatDuration } from "@/lib/challenges/types";

export const metadata: Metadata = { title: "Challenges | QuizBox", description: "Timed quiz challenges open to everyone. Play, score on the server, and see where you rank." };
export const revalidate = 60;

const label = (id: string) => CHALLENGE_CATEGORIES.find((c) => c.id === id)?.label ?? id;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null);

export default async function ChallengesPage() {
  const items = await listPublicChallenges();
  return (
    <PublicShell>
      <PageIntro crumb="Challenges" title="Challenges" lead="Timed quizzes anyone can join. Every answer is scored on our servers, so the leaderboard is fair." />
      <section className="qbp-wrap" style={{ paddingBottom: 64 }} data-qb-section="challenges">
        {items.length === 0 ? (
          <div className="qbp-card" style={{ maxWidth: 640 }}>
            <h2 className="qbp-h3">No open challenges right now</h2>
            <p className="qbp-meta">New challenges appear here when they go live. Teachers and organisers can create one from their account.</p>
            <Link className="qbp-link" href="/login">Sign in</Link>
          </div>
        ) : (
          <div className="qbp-grid">
            {items.map((c) => (
              <article key={c.slug} className="qbp-card">
                <p className="qbp-tag">{label(c.category)}</p>
                <h2 className="qbp-h3"><Link href={`/challenges/${c.slug}`}>{c.title}</Link></h2>
                {c.summary && <p className="qbp-meta">{c.summary}</p>}
                <p className="qbp-meta">{c.question_count} questions · {formatDuration(c.time_limit_seconds * 1000)} · {c.participants} played{c.ends_at ? ` · closes ${when(c.ends_at)}` : ""}</p>
                <Link className="qbp-link" href={`/challenges/${c.slug}`}>View challenge</Link>
              </article>
            ))}
          </div>
        )}
      </section>
    </PublicShell>
  );
}
