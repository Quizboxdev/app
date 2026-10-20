import Link from "next/link";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import { getLibraryStats, listPublicChallenges } from "@/lib/challenges/server";
import { CONTENT_TYPES } from "@/lib/challenges/content-types";
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
  const [items, stats] = await Promise.all([listPublicChallenges(format), getLibraryStats()]);
  const library = stats.documents > 0 ? CONTENT_TYPES.filter((t) => stats.by_type[t.id]).map((t) => `${stats.by_type[t.id]} ${t.plural}`).join(" · ") : "";
  return (
    <PublicShell>
      <PageIntro crumb={copy.title} title={copy.title} lead={copy.lead} />
      <section className="qbp-wrap" style={{ paddingBottom: 64 }} data-qb-section={f.plural}>
        {library && <p className="qbp-meta" style={{ marginBottom: 16 }}><strong>On QuizBox now:</strong> {library}. Read the material, then take the quiz.</p>}
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
                {c.brand?.logo && /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.brand.logo} alt="" width={48} height={48} style={{ objectFit: "contain", borderRadius: 8 }} />}
                <p className="qbp-tag">{c.brand?.organiser_name ? `${c.brand.organiser_name} · ` : ""}{label(c.category)}</p>
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
