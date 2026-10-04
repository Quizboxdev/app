"use client";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import RecordTable from "@/components/RecordTable";
import { humanize } from "@/lib/format";
import { sponsorWorkspaceRequest as call } from "@/lib/api/sponsor-workspace";
export default function SponsorCompetitionOversight() {
  const [data, setData] = useState<Record<string, unknown[]> | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setBusy(true); setError(""); try { setData(await call("oversight")); } catch (cause) { setData(null); setError((cause as Error).message); } finally { setBusy(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  return <><div className="qb-page-head"><h1>Competition oversight</h1><button title="Refresh oversight" aria-label="Refresh oversight" disabled={busy} onClick={() => void load()}><RefreshCw size={16}/></button></div>{error && <p className="qb-error" role="alert">{error}</p>}{data && Object.entries(data).map(([key, rows]) => <section key={key} className="qb-card"><div className="qb-page-head"><h2>{humanize(key)}</h2><span className="qb-pill neutral">{rows.length}</span></div><RecordTable rows={rows} empty={`No ${humanize(key).toLowerCase()} yet.`} /></section>)}</>;
}
