import Image from "next/image";
import Link from "next/link";
import { Check, UserCheck } from "lucide-react";
import { PUBLIC_LINKS } from "./links";

export default function HeroSection() {
  return (
    <section className="qbp-wrap qbp-hero" aria-labelledby="qbp-hero-title" data-qb-section="hero">
      <div className="qbp-hero-copy">
        <p className="qbp-eyebrow">Built for Ghana&apos;s curriculum · Basic 4 to SHS 3</p>
        <h1 id="qbp-hero-title" className="qbp-h1">Turn daily screen time into <span className="qbp-accent">verified academic mastery.</span></h1>
        <p className="qbp-lead">Curriculum-aligned practice, instant feedback and school challenges for Primary, JHS and SHS learners. Questions are built from the GES and NaCCA approved curriculum and reviewed by a subject expert before learners see them.</p>
        <ul className="qbp-trust" aria-label="Why families and schools trust QuizBox">
          <li><Check size={16} aria-hidden="true" /> Built from GES / NaCCA approved curriculum documents</li>
          <li><Check size={16} aria-hidden="true" /> Reviewed by subject experts before use</li>
          <li><Check size={16} aria-hidden="true" /> Works in any phone browser, nothing to install</li>
          <li><Check size={16} aria-hidden="true" /> Automatic marking with instant feedback</li>
        </ul>
        <div className="qbp-actions">
          <Link className="qbp-btn" href={PUBLIC_LINKS.registerStudent} prefetch>Start practising, free</Link>
          <Link className="qbp-btn2" href="/parents">For parents</Link>
          <Link className="qbp-btn2" href={PUBLIC_LINKS.registerTeacher}>For teachers and schools</Link>
        </div>
        <p className="qbp-meta" style={{ marginTop: 8 }}>Sponsors and alumni: <Link className="qbp-link" href={PUBLIC_LINKS.sponsor}>sponsor a school challenge</Link>. Subject experts: <Link className="qbp-link" href={PUBLIC_LINKS.sme}>join as a reviewer</Link>.</p>
      </div>
      <div className="qbp-hero-mark">
        <Image src="/brand/quizbox-mark.webp" alt="QuizBox mark: neon nested squares around a Q" width={340} height={340} priority sizes="(max-width: 960px) 260px, 340px" />
        <div className="qbp-float qbp-float-a">
          <span className="qbp-float-icon" style={{ background: "var(--color-success-bg)", color: "var(--green)" }}><Check size={16} aria-hidden="true" /></span>
          <span><span className="qbp-meta">Curriculum aligned</span><strong>Linked to approved sources</strong></span>
        </div>
        <div className="qbp-float qbp-float-b">
          <span className="qbp-float-icon" style={{ background: "#f1eafb", color: "var(--purple)" }}><UserCheck size={16} aria-hidden="true" /></span>
          <span><span className="qbp-meta">Human in the loop</span><strong>Educator-reviewed content</strong></span>
        </div>
      </div>
    </section>
  );
}
