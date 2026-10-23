import Link from "next/link";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import { RenderText, headingsOf } from "@/lib/policies/render";
import type { PublicPolicy } from "@/lib/policies/server";

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "");

// A published policy as a public page: version and date, a short contents list, the text, and the earlier versions. Pure display (the loader is in lib/policies/server.ts).
export default function PolicyPage({ policy, base }: { policy: PublicPolicy; base: string }) {
  const toc = headingsOf(policy.body), old = policy.state === "superseded";
  return (
    <PublicShell>
      <PageIntro crumb={policy.title} title={policy.title} lead={`Version ${policy.version_no}${policy.effective_at ? `, effective ${date(policy.effective_at)}` : ""}.`} />
      <section className="qbp-wrap" style={{ paddingBottom: 64 }} data-qb-section={policy.slug}>
        {old && <p className="qbp-notice qbp-notice-info" role="note">This is an earlier version of the {policy.title}. <Link className="qbp-link" href={base}>Read the current version</Link>.</p>}
        {toc.length > 2 && (
          <nav aria-label="In this document" className="qbp-prose" style={{ maxWidth: 760 }}>
            <p><strong>In this document</strong></p>
            <ol>{toc.map((h) => <li key={h.id}><a className="qbp-link" href={`#${h.id}`}>{h.text}</a></li>)}</ol>
          </nav>
        )}
        <div className="qbp-prose" style={{ maxWidth: 760 }}>
          <RenderText source={policy.body} />
          {policy.versions.length > 1 && (
            <>
              <h2>Earlier versions</h2>
              <ul>{policy.versions.map((v) => <li key={v.version_no}>{v.version_no === policy.version_no ? <strong>Version {v.version_no}</strong> : <Link className="qbp-link" href={`${base}?v=${v.version_no}`}>Version {v.version_no}</Link>}{v.effective_at ? `, effective ${date(v.effective_at)}` : ""}{v.summary ? `: ${v.summary}` : ""}</li>)}</ul>
            </>
          )}
          <p className="qbp-meta">Issued by QuizBox Solutions, Ghana. <Link className="qbp-link" href="/contact">Contact us</Link>.</p>
        </div>
      </section>
    </PublicShell>
  );
}
