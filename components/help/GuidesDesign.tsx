"use client";

import { useEffect, useState } from "react";
import { bootstrapUser } from "@/lib/auth";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { audienceForRole, type HelpMeta } from "@/lib/help/categories";
import GuideCatalogue from "./GuideCatalogue";

export default function GuidesDesign() {
  const [audience, setAudience] = useState<string | null | undefined>(undefined);
  const [guides, setGuides] = useState<HelpMeta[] | null>(null);
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    bootstrapUser().then(user => { if (alive) setAudience(audienceForRole(user.role as string)); }).catch(() => { if (alive) setAudience(null); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (audience === undefined) return;
    const controller = new AbortController();
    let alive = true;
    const term = query.trim();
    setGuides(null); setFailed(false);
    const timer = setTimeout(async () => {
      try {
        let rows: HelpMeta[];
        if (term.length >= 2) {
          const response = await fetch(`/api/help/search?q=${encodeURIComponent(term)}${audience ? `&audience=${audience}` : ""}`, { signal: controller.signal });
          const body: { results?: HelpMeta[] } = await response.json();
          if (!response.ok || !Array.isArray(body.results)) throw new Error("GUIDES_SEARCH_UNAVAILABLE");
          rows = body.results;
        } else {
          const { data, error } = await getSupabaseBrowserClient().rpc("qb_help_list", { p_audience: audience }).abortSignal(controller.signal);
          if (error || !Array.isArray(data)) throw new Error("GUIDES_LIST_UNAVAILABLE");
          rows = data as HelpMeta[];
        }
        if (alive) setGuides(rows);
      } catch { if (alive && !controller.signal.aborted) setFailed(true); }
    }, term.length >= 2 ? 250 : 0);
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, [audience, query, retry]);
  return <GuideCatalogue guides={guides} audience={audience ?? null} query={query} failed={failed} onAudience={setAudience} onQuery={setQuery} onRetry={() => setRetry(n => n + 1)} />;
}
