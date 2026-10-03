"use client";

import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { getContentMarketContext, listAuthorizedMarkets, selectContentMarket, type MarketContext, type MarketOption } from "@/lib/api/content-context";
import { userFacingError } from "@/lib/errors";

export default function MarketContextControl() {
  const [markets, setMarkets] = useState<MarketOption[]>([]);
  const [context, setContext] = useState<MarketContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    listAuthorizedMarkets().then(rows => { if (mounted) setMarkets(rows); }).catch(cause => { if (mounted) setError(userFacingError(cause)); });
    getContentMarketContext().then(value => { if (mounted) setContext(value); }).catch(cause => { if (mounted) setError(userFacingError(cause)); });
    return () => { mounted = false; };
  }, []);
  const select = async (market: string) => {
    if (!market || busy) return;
    setBusy(true); setError("");
    try { await selectContentMarket(market); window.location.reload(); }
    catch (cause) { setError(userFacingError(cause)); setBusy(false); }
  };
  // Only users authorized for more than one market get a switcher; everyone else sees their market.
  if (markets.length <= 1 && context?.scope !== "MULTI_MARKET" && context?.scope !== "GLOBAL") return <div style={{ display: "flex", alignItems: "center", gap: 6 }}><Globe size={16}/><span aria-label="Content market">{markets[0]?.name ?? ""}</span>{error && <span className="qb-error qb-small" role="alert">{error}</span>}</div>;
  return <div style={{ maxWidth: 260 }}>
    <label style={{ display: "flex", alignItems: "center", gap: 6 }}><Globe size={16}/>Market
      <select aria-label="Content market" value={context?.scope === "LOCAL_MARKET" ? context.market_ids[0] ?? "" : ""} disabled={busy || !markets.length} onChange={event => void select(event.target.value)} style={{ maxWidth: 180 }}>
        <option value="">{context?.scope === "GLOBAL" ? "Global" : context?.scope === "MULTI_MARKET" ? "Selected markets" : "Select market"}</option>
        {markets.map(market => <option key={market.id} value={market.id}>{market.name}</option>)}
      </select>
    </label>
    {error && <span className="qb-error qb-small" role="alert">{error}</span>}
  </div>;
}
