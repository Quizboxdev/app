import type { Metadata } from "next";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import { verifyCertificate } from "@/lib/interschool/server";
import { CERTIFICATE, day } from "@/lib/interschool/text";

// Anyone holding a certificate's reference can check it here. Never indexed.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Check a certificate | QuizBox", robots: { index: false, follow: false } };

export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const code = decodeURIComponent((await params).code).slice(0, 24);
  const x = await verifyCertificate(code);
  return (
    <PublicShell>
      <PageIntro crumb="Certificates" title="Certificate check" lead={`Reference ${code.toUpperCase()}`} />
      <section className="qbp-wrap" style={{ paddingBottom: 64 }}>
        <div className="qbp-card" style={{ maxWidth: 680 }}>
          {!x ? <p role="status"><strong>No certificate has this reference.</strong> Check the letters and numbers and try again.</p> : <>
            <p role="status"><strong>{x.valid ? "This certificate is genuine." : `This certificate was withdrawn on ${day(x.revoked_at)}.`}</strong></p>
            <p>{CERTIFICATE[x.kind] ?? x.kind}<br />Awarded to <strong>{x.recipient}</strong>{x.school && x.school !== x.recipient ? `, ${x.school}` : ""}<br />{x.competition}, {x.division}<br />Issued {day(x.issued_at)}</p>
          </>}
        </div>
      </section>
    </PublicShell>
  );
}
