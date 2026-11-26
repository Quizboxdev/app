"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { myCertificates } from "@/lib/api/interschool";
import { Loading, useLoad } from "@/components/interschool/ui";
import { CERTIFICATE, day } from "@/lib/interschool/text";

// A printable certificate (save as PDF from the print dialog). The QR code opens the public check page for its reference.
export default function CertificatePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const list = useLoad(myCertificates);
  const [qr, setQr] = useState("");
  useEffect(() => { void QRCode.toDataURL(`${window.location.origin}/verify/${code}`, { margin: 1, width: 240 }).then(setQr); }, [code]);
  if (!list.data) return <Loading error={list.error} />;
  const c = list.data.find((x) => x.code === code);
  if (!c) return <div className="qb-card"><p>That certificate is not available to your account. <Link className="qb-link" href="/interschool/certificates">My certificates</Link></p></div>;
  return (
    <>
      <style>{`@media print { body * { visibility: hidden } #qb-certificate, #qb-certificate * { visibility: visible } #qb-certificate { position: fixed; inset: 0; margin: auto } @page { size: A4 landscape; margin: 10mm } }`}</style>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}><button type="button" className="qb-btn" onClick={() => window.print()}>Print or save as PDF</button><Link className="qb-btn qb-btn-secondary" href="/interschool/certificates">Back</Link></div>
      <article id="qb-certificate" style={{ background: "#fff", color: "#0f172a", border: "10px double #1d4ed8", borderRadius: 8, padding: "32px 24px", maxWidth: 900, textAlign: "center", display: "grid", gap: 12, justifyItems: "center" }}>
        <p style={{ margin: 0, fontWeight: 800, fontSize: 24 }}><span style={{ color: "#dc2626" }}>QUIZ</span>BOX</p>
        <h1 style={{ margin: 0, fontSize: 32 }}>{CERTIFICATE[c.kind] ?? c.kind}</h1>
        <p style={{ margin: 0 }}>This is awarded to</p>
        <p style={{ margin: 0, fontSize: 34, fontWeight: 700 }}>{c.recipient}</p>
        {c.school && c.school !== c.recipient && <p style={{ margin: 0, fontSize: 18 }}>{c.school}</p>}
        <p style={{ margin: 0 }}>in the <strong>{c.competition}</strong>, {c.division}</p>
        <p style={{ margin: 0 }}>{day(c.issued_at)}</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- a QR code made in the browser */}
        {qr && <img src={qr} alt="QR code to check this certificate" width={110} height={110} />}
        <p style={{ margin: 0, fontSize: 13 }}>Reference {c.code} · Check it at /verify/{c.code}</p>
      </article>
    </>
  );
}
