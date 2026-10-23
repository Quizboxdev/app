import Link from "next/link";
import BrandLockup from "@/components/BrandLockup";
import { PUBLIC_LINKS } from "./links";

export default function PublicFooter() {
  return (
    <footer className="qbp-footer">
      <div className="qbp-wrap qbp-footer-row">
        <div className="qbp-footer-brand">
          <BrandLockup variant="full" href="/" size={32} />
          <p className="qbp-meta">A curriculum-aligned learning and competition platform for students, teachers, schools, sponsors and subject experts.</p>
        </div>
        <nav aria-label="Platform"><h2>Platform</h2><Link href="/#who">Who it&apos;s for</Link><Link href="/competitions">Competitions</Link><Link href="/#curriculum">Curriculum</Link><Link href={PUBLIC_LINKS.pricing}>Pricing</Link></nav>
        <nav aria-label="Join"><h2>Join</h2><Link href={PUBLIC_LINKS.registerStudent}>Students</Link><Link href={PUBLIC_LINKS.registerTeacher}>Teachers</Link><Link href={PUBLIC_LINKS.school}>Schools</Link><Link href={PUBLIC_LINKS.sponsor}>Sponsors</Link><Link href={PUBLIC_LINKS.sme}>Subject experts</Link></nav>
        <nav aria-label="Company"><h2>Company</h2><Link href={PUBLIC_LINKS.pricing}>Pricing</Link><Link href={PUBLIC_LINKS.contact}>Contact</Link><Link href={PUBLIC_LINKS.privacy}>Privacy</Link><Link href={PUBLIC_LINKS.terms}>Terms</Link><Link href={PUBLIC_LINKS.refunds}>Refunds</Link><Link href={PUBLIC_LINKS.cookies}>Cookies</Link></nav>
      </div>
      <div className="qbp-wrap" style={{ paddingBottom: 24 }}><p className="qbp-meta">© {new Date().getFullYear()} QuizBox Solutions, Ghana · Learn. Practise. Compete.</p>
        <p className="qbp-meta" style={{ marginTop: 6, display: "flex", gap: 16 }}><a href="https://web.facebook.com/profile.php?id=100071020123310" target="_blank" rel="noopener noreferrer">Facebook</a><a href="https://www.linkedin.com/company/94181986" target="_blank" rel="noopener noreferrer">LinkedIn</a></p></div>
    </footer>
  );
}
