import Image from "next/image";
import Link from "next/link";
import { Check, UserCheck } from "lucide-react";
import { PUBLIC_LINKS } from "./links";

export default function HeroSection() {
  return (
    <section className="qbp-wrap qbp-hero" aria-labelledby="qbp-hero-title" data-qb-section="hero">
      <div className="qbp-hero-copy">
        <p className="qbp-eyebrow">Curriculum-aligned · Human-reviewed · Global ready</p>
        <h1 id="qbp-hero-title" className="qbp-h1">Learn it. Practice it.<br /><span className="qbp-accent">Challenge someone.</span></h1>
        <p className="qbp-lead">A curriculum-aligned learning and competition platform. Students practise and compete, teachers assign and monitor, sponsors support challenges, and qualified subject experts review content before it reaches learners.</p>
        <div className="qbp-actions">
          <Link className="qbp-btn" href={PUBLIC_LINKS.registerStudent}>I&apos;m a Student</Link>
          <Link className="qbp-btn2" href={PUBLIC_LINKS.registerTeacher}>I&apos;m a Teacher</Link>
          <Link className="qbp-btn2" href={PUBLIC_LINKS.sponsor}>I want to sponsor</Link>
          <Link className="qbp-btn2" href={PUBLIC_LINKS.sme}>I&apos;m a Subject Expert</Link>
        </div>
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
