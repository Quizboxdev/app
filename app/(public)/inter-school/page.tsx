import type { Metadata } from "next";
import Link from "next/link";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import LogoImage from "@/components/challenges/LogoImage";
import { listPublicCompetitions } from "@/lib/interschool/server";
import { REGISTRATION, day } from "@/lib/interschool/text";
import { SITE_URL } from "@/lib/site";

export const revalidate = 60;
export const metadata: Metadata = { title: "Inter-school competitions | QuizBox", description: "Quiz competitions between schools on QuizBox. Find one that is open and register your school.", alternates: { canonical: `${SITE_URL}/inter-school` } };

export default async function InterschoolListPage() {
  const rows = await listPublicCompetitions(48);
  return (
    <PublicShell>
      <PageIntro crumb="Inter-school" title="Inter-school competitions" lead="Schools compete level by level, subject by subject. Open competitions are listed here." />
      <section className="qbp-wrap" style={{ paddingBottom: 64, display: "grid", gap: 16 }}>
        {rows.length === 0 && <div className="qbp-card"><p>No competition is open to the public right now. School staff can organise one after signing in.</p></div>}
        {rows.map((c) => (
          <article key={c.slug} className="qbp-card" style={{ maxWidth: 820 }}>
            {c.sponsor_logo_url && <LogoImage src={c.sponsor_logo_url} alt={`${c.sponsor_name ?? "Sponsor"} logo`} width={56} height={56} style={{ objectFit: "contain" }} />}
            <h2 className="qbp-h3"><Link className="qbp-link" href={`/inter-school/${c.slug}`}>{c.title}</Link></h2>
            <p className="qbp-meta">{(c.divisions ?? []).join(", ")}{c.sponsor_name ? ` · Sponsored by ${c.sponsor_name}` : ""}</p>
            {c.summary && <p>{c.summary}</p>}
            <p className="qbp-meta">{REGISTRATION[c.registration]} · Register by {day(c.registration_closes_at)} · Runs {day(c.opens_at)} to {day(c.ends_at)}</p>
          </article>))}
      </section>
    </PublicShell>
  );
}
