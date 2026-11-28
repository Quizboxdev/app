"use client";

import { use, useState } from "react";
import Link from "next/link";
import { manageGet } from "@/lib/api/interschool";
import { Head, Loading, useLoad } from "@/components/interschool/ui";
import DetailsTab from "@/components/interschool/manage/DetailsTab";
import RoundsTab from "@/components/interschool/manage/RoundsTab";
import PublishTab from "@/components/interschool/manage/PublishTab";
import SchoolsTab from "@/components/interschool/manage/SchoolsTab";
import PlayTab from "@/components/interschool/manage/PlayTab";
import { BillingTab, CampaignTab, CertificatesTab } from "@/components/interschool/manage/MoneyAndCampaignTabs";
import { humanStatus } from "@/lib/interschool/text";

const TABS = ["Details", "Levels and rounds", "Preview and publish", "Schools", "Fixtures and results", "Billing", "Campaign", "Certificates"] as const;

export default function ManageOnePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const c = useLoad(() => manageGet(id), [id]);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Details");
  if (!c.data) return <><Head title="Competition" /><Loading error={c.error} /></>;
  const data = c.data;
  return (
    <>
      <Head title={data.title} lead={`${humanStatus(data.status)}${data.decision_note ? ` · ${data.decision_note}` : ""}`}><Link className="qb-btn qb-btn-secondary" href="/interschool/manage">All competitions</Link></Head>
      <div role="tablist" aria-label="Competition sections" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={`qb-btn${tab === t ? "" : " qb-btn-secondary"}`} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      {tab === "Details" && <DetailsTab c={data} reload={c.reload} />}
      {tab === "Levels and rounds" && <RoundsTab c={data} reload={c.reload} />}
      {tab === "Preview and publish" && <PublishTab c={data} reload={c.reload} />}
      {tab === "Schools" && <SchoolsTab c={data} />}
      {tab === "Fixtures and results" && <PlayTab c={data} reload={c.reload} />}
      {tab === "Billing" && <BillingTab c={data} reload={c.reload} />}
      {tab === "Campaign" && <CampaignTab c={data} reload={c.reload} />}
      {tab === "Certificates" && <CertificatesTab c={data} />}
    </>
  );
}
