import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import LogoImage from "@/components/challenges/LogoImage";
import Qr from "@/components/interschool/Qr";
import PublicActions from "@/components/interschool/PublicActions";
import { getPublicCompetition, getPublicResults } from "@/lib/interschool/server";
import { REGISTRATION, SCORING, TIE_BREAK, campaignLink, canRegister, day, levelName, minutes, ruleText, when } from "@/lib/interschool/text";
import { SITE_URL } from "@/lib/site";

// The public page of a competition: its campaign link always works; whether registration is accepted is decided by the database.
export const revalidate = 30;
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await getPublicCompetition((await params).slug);
  if (!c) return { title: "Competition | QuizBox", robots: { index: false, follow: false } };
  const url = `${SITE_URL}/inter-school/${c.slug}`;
  const description = (c.description || `${c.divisions.map((d) => d.title).join(", ")}. Register by ${day(c.registration_closes_at)}.`).slice(0, 200);
  return { title: `${c.title} | QuizBox`, description, alternates: { canonical: url }, robots: c.participation === "OPEN" && c.listed ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title: c.title, description, url, type: "website", siteName: "QuizBox" }, twitter: { card: "summary_large_image", title: c.title, description } };
}

export default async function PublicCompetitionPage({ params }: Props) {
  const slug = (await params).slug;
  const c = await getPublicCompetition(slug);
  if (!c) notFound();
  const results = await getPublicResults(slug);
  const card = { maxWidth: 820 } as const;
  return (
    <PublicShell>
      <PageIntro crumb="Inter-school" eyebrow={c.sponsor_name ? `Sponsored by ${c.sponsor_name}` : c.host ? `Hosted by ${c.host}` : undefined} title={c.title} lead={c.description || "An inter-school quiz competition on QuizBox."} />
      <section className="qbp-wrap" style={{ paddingBottom: 64, display: "grid", gap: 24 }} data-qb-section="interschool">
        <div className="qbp-card" style={card}>
          {c.sponsor_logo_url && <LogoImage src={c.sponsor_logo_url} alt={`${c.sponsor_name ?? "Sponsor"} logo`} width={96} height={96} style={{ objectFit: "contain" }} />}
          <p><strong>{REGISTRATION[c.registration]}</strong> · {c.participation === "OPEN" ? "Open to verified schools" : "By invitation"} · {c.schools_registered}{c.max_schools ? ` of ${c.max_schools}` : ""} school{c.schools_registered === 1 ? "" : "s"} registered</p>
          <p className="qbp-meta">Registration: {when(c.registration_opens_at)} to {when(c.registration_closes_at)}<br />Competition: {when(c.opens_at)} to {when(c.ends_at)}<br />
            {c.places_left} place{c.places_left === 1 ? "" : "s"} left{c.max_per_school ? ` · up to ${c.max_per_school} learners per school` : ""}{[c.district, c.region].filter(Boolean).length ? ` · ${[c.district, c.region].filter(Boolean).join(", ")}` : ""}</p>
          <Suspense fallback={null}><PublicActions slug={c.slug} title={c.title} closes={c.registration_closes_at} sponsor={c.sponsor_name} canRegister={canRegister(c.registration)} state={REGISTRATION[c.registration]} /></Suspense>
        </div>

        <div className="qbp-card" style={card}>
          <h2 className="qbp-h3">How to take part</h2>
          <ol className="qbp-list">
            <li>Create or sign in to your free QuizBox account.</li>
            <li>{c.registration_mode === "TEACHER" ? "Ask a teacher at your school to enter you." : c.registration_mode === "LEARNER" ? "Choose your class level and school, then register." : "Register yourself, or ask a teacher to enter you."} Your school confirms who you are.</li>
            <li>When a round opens, answer it once, on any phone or computer. The timer runs on the QuizBox server; your answers are saved as you go.</li>
            <li>Results and who goes through are published when the round closes.</li>
          </ol>
          <p className="qbp-meta">Sponsored and school competitions do not require a paid subscription.</p>
        </div>

        {c.divisions.map((d) => (
          <div className="qbp-card" style={card} key={d.id}>
            <h2 className="qbp-h3">{d.title}</h2>
            <p className="qbp-meta">{d.level_codes.map(levelName).join(", ")} · {d.subjects.join(", ")}</p>
            <ol className="qbp-list">{d.rounds.map((r) => <li key={r.round_no}><strong>{r.title}</strong>: {when(r.opens_at)} to {when(r.closes_at)} · {r.question_count} questions in {minutes(r.duration_seconds)}{r.round_no < d.rounds.length ? ` · ${ruleText(r.rule, r.pass_percent, r.top_n)}` : ""}</li>)}</ol>
          </div>))}

        {(c.rules || c.prizes) && <div className="qbp-card" style={card}>
          {c.prizes && <><h2 className="qbp-h3">Prizes</h2><p style={{ whiteSpace: "pre-line" }}>{c.prizes}</p></>}
          {c.rules && <><h2 className="qbp-h3">Rules</h2><p style={{ whiteSpace: "pre-line" }}>{c.rules}</p></>}
          <p className="qbp-meta">School ranking: {SCORING[c.school_scoring] ?? c.school_scoring}. {TIE_BREAK}</p>
        </div>}

        {results.length > 0 && <div className="qbp-card" style={card}>
          <h2 className="qbp-h3">Results</h2>
          {results.map((r) => <details key={`${r.division}-${r.round_no}`}><summary><strong>{r.division}: {r.round}</strong></summary>
            <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th align="left">Rank</th><th align="left">School</th><th align="right">Score</th></tr></thead>
              <tbody>{r.schools.map((s) => <tr key={s.institution_id}><td>{s.rank ?? "-"}</td><td>{s.school}{s.qualified ? " (through)" : ""}</td><td align="right">{s.total_score}</td></tr>)}</tbody></table></div>
            {r.leaders.length > 0 && <><p><strong>Leading learners</strong></p><ol className="qbp-list">{r.leaders.map((l, i) => <li key={i}>{l.name}{l.school ? `, ${l.school}` : ""}: {l.percent}%</li>)}</ol></>}
          </details>)}
        </div>}

        <div className="qbp-card" style={card}>
          <h2 className="qbp-h3">Scan to open this page</h2>
          <Qr value={campaignLink(SITE_URL, c.slug, "QR")} label={`QR code for ${c.title}`} />
          <p><Link className="qbp-link" href={`/inter-school/${c.slug}/flyer`}>Printable flyer</Link>{c.flyer_url && <> · <a className="qbp-link" href={c.flyer_url} target="_blank" rel="noopener noreferrer">Organiser&apos;s flyer</a></>}</p>
        </div>
      </section>
    </PublicShell>
  );
}
