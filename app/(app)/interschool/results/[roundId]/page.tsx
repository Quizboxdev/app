"use client";

import { use } from "react";
import Link from "next/link";
import { roundResults } from "@/lib/api/interschool";
import { Head, Loading, useLoad } from "@/components/interschool/ui";
import ResultsView from "@/components/interschool/ResultsView";
import { TIE_BREAK } from "@/lib/interschool/text";

export default function ResultsPage({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = use(params);
  const r = useLoad(() => roundResults(roundId), [roundId]);
  if (!r.data) return <><Head title="Results" /><Loading error={r.error} /></>;
  return (
    <>
      <Head title={r.data.competition ?? "Results"} lead={r.data.finalised ? `${r.data.division} · ${r.data.round}. ${TIE_BREAK}` : undefined}><Link className="qb-btn qb-btn-secondary" href="/interschool">Back</Link></Head>
      <ResultsView r={r.data} />
    </>
  );
}
