import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import { getPublicChallenge, getPublicLeaderboard } from "@/lib/challenges/server";
import { CHALLENGE_CATEGORIES, FORMATS, formatDuration, formatOf, readableText, type Format } from "@/lib/challenges/types";
import { SITE_URL } from "@/lib/site";
import ViewBeacon from "@/components/challenges/ViewBeacon";
import ReportChallenge from "@/components/challenges/ReportChallenge";
import ShareBar from "@/components/challenges/ShareBar";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Link previews and search results only for public and unlisted campaigns that are open or finished; private ones are never indexed or described.
export async function detailMetadata(slug: string, format: Format): Promise<Metadata> {
  const f = FORMATS[format], c = await getPublicChallenge(slug);
  if (!c || c.private) return { title: `${cap(f.noun)} | QuizBox`, robots: { index: false, follow: false } };
  const url = `${SITE_URL}${FORMATS[formatOf(c.format)].base}/${c.slug}`;
  const description = c.summary || `${c.question_count} questions, ${Math.round(c.time_limit_seconds / 60)} minutes. Take part in this QuizBox ${f.noun}.`;
  return {
    title: `${c.title} | QuizBox ${cap(f.plural)}`, description, alternates: { canonical: url },
    robots: c.visibility === "PUBLIC" ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title: c.title, description, url, type: "website", siteName: "QuizBox" },
    twitter: { card: "summary", title: c.title, description },
  };
}

export default async function PublicDetail({ slug, format }: { slug: string; format: Format }) {
  const c = await getPublicChallenge(slug);
  if (!c) notFound();
  // A shared link always works: a competition opened under /challenges (or the other way round) goes to its own page.
  if (formatOf(c.format) !== format) redirect(`${FORMATS[formatOf(c.format)].base}/${c.slug}`);
  const f = FORMATS[format];
  const board = c.private ? [] : await getPublicLeaderboard(slug);
  const category = CHALLENGE_CATEGORIES.find((x) => x.id === c.category)?.label;
  const play = `/play/${c.slug}`, accent = c.brand?.accent;
  const btn = accent ? { background: accent, color: readableText(accent), borderColor: accent } : undefined;
  const stages = c.stages ?? [];
  return (
    <PublicShell>
      <PageIntro crumb={cap(f.plural)} eyebrow={c.brand?.organiser_name ? `${c.brand.organiser_name}${c.brand.tagline ? ` · ${c.brand.tagline}` : ""}` : undefined} title={c.title} lead={c.private ? `This ${f.noun} is private. Sign in and enter the access code you were given.` : c.summary} />
      <ViewBeacon slug={c.slug} />
      <section className="qbp-wrap" style={{ paddingBottom: 64, display: "grid", gap: 24 }} data-qb-section={f.noun}>
        <div className="qbp-card" style={{ maxWidth: 820, ...(accent ? { borderTop: `6px solid ${accent}` } : {}) }}>
          {c.brand?.welcome && <p>{c.brand.welcome}</p>}
          {!c.private && <p className="qbp-meta">{category} · {c.question_count} questions · {formatDuration(c.time_limit_seconds * 1000)} · {c.max_attempts} attempt{c.max_attempts === 1 ? "" : "s"} · {c.participants} played</p>}
          {c.audience === "CLASS" && <p className="qbp-meta">Open to the members of one class. Sign in with your school account to take part.</p>}
          {c.audience === "SCHOOL" && <p className="qbp-meta">Open to the members of one school. Sign in with your school account to take part.</p>}
          {c.reward_text && <p><strong>Prize or recognition:</strong> {c.reward_text}</p>}
          {c.live ? (
            <p><Link className="qbp-btn" style={btn} href={play}>{format === "COMPETITION" ? "Join the competition" : "Play now"}</Link> <span className="qbp-meta">You need a free account. Sign up and you come straight back here.</span></p>
          ) : (
            <p className="qbp-meta">{c.status === "COMPLETED" ? `This ${f.noun} has finished.` : c.status === "PAUSED" ? `This ${f.noun} is paused.` : `This ${f.noun} is not open right now.`}</p>
          )}
        </div>
        {!c.private && format === "COMPETITION" && stages.length > 0 && (
          <div className="qbp-card" style={{ maxWidth: 820 }}>
            <h2 className="qbp-h3">Rounds</h2>
            <ol className="qbp-list">{stages.map((s) => <li key={s.stage_no}><strong>{s.title}</strong> · {s.question_count} questions · {formatDuration(s.time_limit_seconds * 1000)}{s.stage_no < stages.length && s.pass_percent > 0 ? ` · score ${s.pass_percent}% or more to go through` : ""}{s.stage_no < stages.length && s.advance_top_n ? ` · the top ${s.advance_top_n} go through` : ""}{s.ends_at ? ` · closes ${new Date(s.ends_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</li>)}</ol>
          </div>
        )}
        {!c.private && (c.prizes?.length ?? 0) > 0 && (
          <div className="qbp-card" style={{ maxWidth: 820 }}>
            <h2 className="qbp-h3">Prizes</h2>
            <ul className="qbp-list">{c.prizes!.map((p, i) => <li key={i}><strong>{p.rank_from === p.rank_to ? `Rank ${p.rank_from}` : `Ranks ${p.rank_from} to ${p.rank_to}`}:</strong> {p.title}{p.details ? <span className="qbp-meta"> · {p.details}</span> : null}</li>)}</ul>
            <p className="qbp-meta">Winners are contacted by the organiser at their account email.</p>
          </div>
        )}
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
        {!c.private && c.live && c.audience !== "CLASS" && c.audience !== "SCHOOL" && <div style={{ maxWidth: 820 }}><ShareBar slug={c.slug} title={c.title} format={c.format} /></div>}
        {!c.private && c.visibility !== "PRIVATE" && <div style={{ maxWidth: 820 }}><ReportChallenge slug={c.slug} /></div>}
      </section>
    </PublicShell>
  );
}
