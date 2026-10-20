import Link from "next/link";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import { listPublicChallenges } from "@/lib/challenges/server";
import { CHALLENGE_CATEGORIES, FORMATS, formatDuration, type Format } from "@/lib/challenges/types";

const label = (id: string) => CHALLENGE_CATEGORIES.find((c) => c.id === id)?.label ?? id;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null);
const COPY: Record<Format, { title: string; lead: string; none: string; noneText: string }> = {
  CHALLENGE: { title: "Challenges", lead: "Timed quizzes anyone can join. Every answer is scored on our servers, so the leaderboard is fair.", none: "No open challenges right now", noneText: "New challenges appear here when they go live. Anyone with an account can create one and share it." },
  COMPETITION: { title: "Competitions", lead: "Take part in rounds. The best players go through to the next round until a winner is found.", none: "No open competitions right now", noneText: "New competitions appear here when they go live. Teachers, schools, sponsors and learners can run one and share it." },
};

// One list for both formats: a Challenge is a single timed round, a Competition has rounds that pass players on.
export default async function PublicList({ format }: { format: Format }) {
  const f = FORMATS[format], copy = COPY[format];
  const items = await listPublicChallenges(format);
  return (
    <PublicShell>
      <PageIntro crumb={copy.title} title={copy.title} lead={copy.lead} />
      <section className="qbp-wrap" style={{ paddingBottom: 64 }} data-qb-section={f.plural}>
        {items.length === 0 ? (
          <div className="qbp-card" style={{ maxWidth: 640 }}>
            <h2 className="qbp-h3">{copy.none}</h2>
            <p className="qbp-meta">{copy.noneText}</p>
            <Link className="qbp-link" href="/login">Sign in or create an account</Link>
          </div>
        ) : (
          <div className="qbp-grid">
            {items.map((c) => (
              <article key={c.slug} className="qbp-card">
                <p className="qbp-tag">{label(c.category)}</p>
                <h2 className="qbp-h3"><Link href={`${f.base}/${c.slug}`}>{c.title}</Link></h2>
                {c.summary && <p className="qbp-meta">{c.summary}</p>}
                <p className="qbp-meta">{format === "COMPETITION" && (c.stage_count ?? 1) > 1 ? `${c.stage_count} rounds · ` : ""}{c.question_count} questions · {formatDuration(c.time_limit_seconds * 1000)} · {c.participants} played{c.ends_at ? ` · closes ${when(c.ends_at)}` : ""}</p>
                <Link className="qbp-link" href={`${f.base}/${c.slug}`}>View {f.noun}</Link>
              </article>
            ))}
          </div>
        )}
      </section>
    </PublicShell>
  );
}
