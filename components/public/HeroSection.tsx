import Image from "next/image";
import Link from "next/link";
import { Check, UserCheck } from "lucide-react";
import { PUBLIC_LINKS } from "./links";

export default function HeroSection() {
  return (
    <section className="qbp-wrap qbp-hero" aria-labelledby="qbp-hero-title" data-qb-section="hero">
      <div className="qbp-hero-copy">
        <p className="qbp-eyebrow">Curriculum-aligned · Expert-reviewed · Ghana first</p>
        <h1 id="qbp-hero-title" className="qbp-h1">Learn. Practise.<br /><span className="qbp-accent">Compete.</span></h1>
        <p className="qbp-lead">Curriculum-aligned practice for Primary, JHS and SHS learners. Every question is traced to the curriculum and reviewed by a subject expert.</p>
        <div className="qbp-actions">
          <Link className="qbp-btn" href={PUBLIC_LINKS.registerStudent}>Start practising, free</Link>
          <Link className="qbp-btn2" href={PUBLIC_LINKS.registerTeacher}>For teachers and schools</Link>
        </div>
        <p className="qbp-meta" style={{ marginTop: 8 }}>Sponsors and subject experts: <Link className="qbp-link" href={PUBLIC_LINKS.sponsor}>partner with us</Link> or <Link className="qbp-link" href={PUBLIC_LINKS.sme}>join as a subject expert</Link>.</p>
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
