"use client";

import Link from "next/link";
import { myCertificates } from "@/lib/api/interschool";
import { Head, Loading, Table, useLoad } from "@/components/interschool/ui";
import { CERTIFICATE, day } from "@/lib/interschool/text";

export default function CertificatesPage() {
  const list = useLoad(myCertificates);
  if (!list.data) return <><Head title="Certificates" /><Loading error={list.error} /></>;
  return (
    <>
      <Head title="Certificates" lead="Awarded after a competition's results are final. Anyone can check a certificate with its reference."><Link className="qb-btn qb-btn-secondary" href="/interschool">Back</Link></Head>
      <div className="qb-card">{list.data.length === 0 ? <p className="qb-muted">No certificates yet.</p> : (
        <Table head={["Certificate", "Awarded to", "Competition", "Issued", ""]}>{list.data.map((c) => <tr key={c.code}><td>{CERTIFICATE[c.kind] ?? c.kind}</td><td>{c.recipient}</td><td>{c.competition} · {c.division}</td><td>{day(c.issued_at)}</td><td><Link className="qb-link" href={`/interschool/certificates/${c.code}`}>Download</Link></td></tr>)}</Table>)}</div>
    </>
  );
}
