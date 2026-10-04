import Link from "next/link";
import PublicShell from "./PublicShell";
import PageIntro from "./PageIntro";

// LEGAL_CONTENT_REQUIRED (internal marker only; never rendered as visible text).
// No approved legal copy exists in the repository. This page states that the formal policy is being
// finalized and publishes no policy terms. Keep the route noindex until approved text replaces it.
export default function LegalPlaceholder({ title, crumb, notice }: { title: string; crumb: string; notice: string }) {
  return (
    <PublicShell>
      <PageIntro title={title} crumb={crumb} />
      <section className="qbp-wrap" style={{ paddingBottom: 64 }} data-legal-status="LEGAL_CONTENT_REQUIRED">
        <div className="qbp-prose">
          <p className="qbp-notice qbp-notice-info" role="note">{notice}</p>
          <p className="qbp-meta"><Link className="qbp-link" href="/contact">Go to the contact page</Link></p>
        </div>
      </section>
    </PublicShell>
  );
}
