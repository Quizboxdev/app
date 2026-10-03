"use client";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { sponsorWorkspaceRequest as call } from "@/lib/api/sponsor-workspace";
export default function SponsorCompetitionOversight() {
  const [data, setData] = useState<Record<string, unknown[]> | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setBusy(true); setError(""); try { setData(await call("oversight")); } catch (cause) { setData(null); setError((cause as Error).message); } finally { setBusy(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  return <><div className="qb-page-head"><h1>Competition oversight</h1><button title="Refresh oversight" aria-label="Refresh oversight" disabled={busy} onClick={() => void load()}><RefreshCw size={16}/></button></div>{error && <p className="qb-error" role="alert">{error}</p>}{data && Object.entries(data).map(([key, rows]) => <details key={key}><summary>{key.replaceAll("_", " ")} ({rows.length})</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(rows, null, 2)}</pre></details>)}</>;
}
