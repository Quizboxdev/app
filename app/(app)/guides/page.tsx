"use client";

import { useEffect, useState } from "react";
import HelpHome from "@/components/help/HelpHome";
import { audienceForRole, type HelpMeta } from "@/lib/help/categories";
import { bootstrapUser } from "@/lib/auth";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useWorkspaceFlags } from "@/components/WorkspaceProvider";
import GuidesDesign from "@/components/help/GuidesDesign";

// Help inside the app, for everyone signed in: the guides for your role come first, the rest are found by search. Administrator workflows are not part of Help.
export default function GuidesPage() {
  return useWorkspaceFlags().design_v02_help ? <GuidesDesign /> : <LegacyGuidesPage />;
}

function LegacyGuidesPage() {
  const [guides, setGuides] = useState<HelpMeta[] | null>(null), [audience, setAudience] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      let a: string | null = null;
      try { a = audienceForRole((await bootstrapUser()).role as string); } catch { /* the shell already handles sign-in problems */ }
      const { data } = await Promise.resolve(getSupabaseBrowserClient().rpc("qb_help_list", { p_audience: a }));
      if (alive) { setAudience(a); setGuides(Array.isArray(data) ? (data as HelpMeta[]) : []); }
    })().catch(() => { if (alive) setGuides([]); });
    return () => { alive = false; };
  }, []);
  return (
    <>
      <div className="qb-page-head"><div><h1>Help</h1><p>Simple guides for what you do on QuizBox. Search, or choose a topic.</p></div></div>
      {guides === null ? <p className="qb-muted">Loading…</p> : <HelpHome guides={guides} base="/guides" audience={audience} inApp />}
    </>
  );
}
