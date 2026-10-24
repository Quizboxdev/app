import "./(public)/public.css";
import Link from "next/link";
import type { Metadata } from "next";
import PublicShell from "@/components/public/PublicShell";

// A mistyped or expired link used to land on a bare "404" with no links at all (audit UX-021). The status stays 404.
export const metadata: Metadata = { title: "Page not found | QuizBox" };

export default function NotFound() {
  return (
    <div className="qbp">
      <PublicShell>
        <section className="qbp-wrap qbp-page-head" style={{ paddingBottom: 64 }}>
          <h1 className="qbp-h2" style={{ fontSize: "clamp(26px, 3vw, 32px)" }}>We could not find that page</h1>
          <p className="qbp-lead">The link may be old or mistyped. Try one of these:</p>
          <ul>
            <li><Link className="qbp-link" href="/">Home</Link></li>
            <li><Link className="qbp-link" href="/login?mode=register&role=student">Start practising, free</Link></li>
            <li><Link className="qbp-link" href="/challenges">Challenges</Link></li>
            <li><Link className="qbp-link" href="/help">Help</Link></li>
            <li><Link className="qbp-link" href="/contact">Contact us</Link></li>
          </ul>
        </section>
      </PublicShell>
    </div>
  );
}
