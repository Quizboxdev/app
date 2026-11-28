import type { Metadata } from "next";
import Link from "next/link";
import PublicShell from "@/components/public/PublicShell";
import FaqSection from "@/components/public/FaqSection";
import { FAMILY_FEATURES, PARENT_COLOR } from "@/components/public/ParentsSection";
import { PUBLIC_LINKS } from "@/components/public/links";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "For parents | QuizBox",
  description: "A short, regular study habit your child can keep, and one family space where you follow their progress, give practice and pay once for every child.",
  alternates: { canonical: `${SITE_URL}/parents` },
  openGraph: { type: "website", siteName: "QuizBox", url: `${SITE_URL}/parents`, title: "QuizBox for parents", description: "Turn screen time into school progress, with a family space to follow every child." },
};
export const revalidate = 300;

// The evening routine is a suggestion, not a promise or a measured result: nothing here states how long a session takes or what a child will gain.
const ROUTINE = [
  { title: "1 · Agree the reward", text: "Pick something small your child cares about for finishing the session: a favourite snack, extra play time or a weekend outing. You decide the reward. QuizBox does not give or require one." },
  { title: "2 · Sit down for a short sprint", text: "Agree a short session, for example 15 minutes, and let your child practise questions for their class and subject. Every answer gets instant feedback." },
  { title: "3 · Look at the result together", text: "Open your family space, see what was completed and the monthly average, and celebrate the effort before you choose the next topic." },
];

export default function ParentsPage() {
  return (
    <PublicShell>
      <section className="qbp-wrap qbp-hero" aria-labelledby="qbp-parents-hero" data-qb-section="parents-hero" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
        <div className="qbp-hero-copy">
          <p className="qbp-eyebrow" style={{ color: PARENT_COLOR }}>For parents &amp; guardians</p>
          <h1 id="qbp-parents-hero" className="qbp-h1">Turn screen time into <span className="qbp-accent">school progress.</span></h1>
          <p className="qbp-lead">A short, regular study habit your child can keep, with one family space where you follow what they do. Questions are built from the GES and NaCCA approved curriculum and reviewed by a subject expert before your child sees them.</p>
          <div className="qbp-actions">
            <Link className="qbp-btn" href={PUBLIC_LINKS.registerParent} prefetch>Create your family space</Link>
            <Link className="qbp-btn2" href="/help/parents-and-family-workspace">How to set up your family</Link>
          </div>
          <p className="qbp-meta">When you sign up, choose <strong>Parent or guardian</strong> under &ldquo;I am a&rdquo;. Your Family workspace opens from the menu.</p>
        </div>
      </section>

      <section className="qbp-sec qbp-alt" aria-labelledby="qbp-routine-title" data-qb-section="parents-routine">
        <div className="qbp-wrap" style={{ display: "grid", gap: 16 }}>
          <div className="qbp-head" style={{ marginBottom: 0 }}>
            <p className="qbp-eyebrow" style={{ color: PARENT_COLOR }}>A routine to try</p>
            <h2 id="qbp-routine-title" className="qbp-h2">The evening study habit, in three steps</h2>
          </div>
          <ol className="qbp-stages" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {ROUTINE.map((s) => <li key={s.title} className="qbp-card"><span className="qbp-step" style={{ color: PARENT_COLOR }}>{s.title}</span><p className="qbp-meta" style={{ fontSize: 14 }}>{s.text}</p></li>)}
          </ol>
        </div>
      </section>

      <section className="qbp-sec" aria-labelledby="qbp-family-title" data-qb-section="parents-family">
        <div className="qbp-wrap" style={{ display: "grid", gap: 16 }}>
          <div className="qbp-head" style={{ marginBottom: 0 }}>
            <p className="qbp-eyebrow" style={{ color: PARENT_COLOR }}>Your family space</p>
            <h2 id="qbp-family-title" className="qbp-h2">What you can do</h2>
          </div>
          <ul className="qbp-grid" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {FAMILY_FEATURES.map((f) => <li key={f.title} className="qbp-card" style={{ borderLeft: `3px solid ${PARENT_COLOR}` }}><h3 className="qbp-h3">{f.title}</h3><p className="qbp-meta" style={{ fontSize: 14 }}>{f.text}</p></li>)}
          </ul>
          <div className="qbp-split">
            <div className="qbp-card">
              <h3 className="qbp-h3">What it costs</h3>
              <p className="qbp-meta" style={{ fontSize: 14 }}>Starting is free: everyone gets free sessions when they sign up. Coins and subscriptions are listed on the Pricing page, and you can buy for one child or several in one checkout.</p>
              <div className="qbp-actions"><Link className="qbp-btn2" href={PUBLIC_LINKS.pricing}>See pricing</Link></div>
            </div>
            <div className="qbp-card">
              <h3 className="qbp-h3">Private by design</h3>
              <ul className="qbp-list">
                <li>You only see the children linked to your family.</li>
                <li>Removing a child ends your link only. Their account, school and results stay the same.</li>
                <li>Children under 13 have extra protection, and they do not pay online.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <FaqSection where="parents" id="parents-faq" />

      <section className="qbp-sec" aria-labelledby="qbp-parents-cta" data-qb-section="parents-cta">
        <div className="qbp-wrap" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
          <div style={{ display: "grid", gap: 6, flex: "1 1 420px", minWidth: 0 }}>
            <h2 id="qbp-parents-cta" className="qbp-h2">Start with one child and one subject.</h2>
            <p className="qbp-body">Free to start. Add more children whenever you are ready.</p>
          </div>
          <div className="qbp-actions"><Link className="qbp-btn" href={PUBLIC_LINKS.registerParent} prefetch>Create your family space</Link><Link className="qbp-btn2" href={PUBLIC_LINKS.login} prefetch>Sign in</Link></div>
        </div>
      </section>
    </PublicShell>
  );
}
