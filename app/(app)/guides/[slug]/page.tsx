"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import HelpArticleView from "@/components/help/HelpArticleView";
import type { HelpDetail } from "@/lib/help/categories";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// One guide inside the app, so you never leave the signed-in menu to read it.
export default function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [detail, setDetail] = useState<HelpDetail | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    Promise.resolve(getSupabaseBrowserClient().rpc("qb_help_get", { p_slug: slug })).then(({ data }) => { if (alive) setDetail((data as HelpDetail) ?? null); }).catch(() => { if (alive) setDetail(null); });
    return () => { alive = false; };
  }, [slug]);
  if (detail === undefined) return <p className="qb-muted">Loading…</p>;
  if (detail === null) return <div className="qb-card"><h1>We could not find that guide</h1><p><Link className="qb-link" href="/guides">See all guides</Link>, or <Link className="qb-link" href="/support/new">send us a support request</Link>.</p></div>;
  return (
    <>
      <div className="qb-page-head"><div><h1>{detail.article.title}</h1><p>{detail.article.summary}</p></div></div>
      <HelpArticleView detail={detail} inApp />
    </>
  );
}
