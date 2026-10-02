"use client";

import { FormEvent, useEffect, useState } from "react";
import { Save } from "lucide-react";
import { createContentContext, listAuthorizedMarkets, listAuthorizedSources, setCompetitionContentContext, type MarketOption, type SourceOption } from "@/lib/api/content-context";
import { userFacingError } from "@/lib/errors";

export default function CompetitionContentScope() {
  const [markets, setMarkets] = useState<MarketOption[]>([]), [sources, setSources] = useState<SourceOption[]>([]);
  const [marketIds, setMarketIds] = useState<string[]>([]), [sourceIds, setSourceIds] = useState<string[]>([]);
  const [scope, setScope] = useState("LOCAL_MARKET"), [mode, setMode] = useState("CURRICULUM_ALIGNED");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => {
    let current = true;
    listAuthorizedMarkets().then(m => { if (current) setMarkets(m); }).catch(cause => { if (current) setError(userFacingError(cause)); });
    return () => { current=false; };
  }, []);
  useEffect(() => {
    let current=true;setSources([]);
    if(scope==="GLOBAL" || scope==="LOCAL_MARKET" && marketIds.length===1 || scope==="MULTI_MARKET" && marketIds.length>=2) listAuthorizedSources(undefined,{scope,markets:marketIds}).then(rows=>{if(current)setSources(rows);}).catch(cause=>{if(current)setError(userFacingError(cause));});
    return ()=>{current=false;};
  },[scope,marketIds]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if(busy)return;setBusy(true);setError("");setNotice("");
    const competition=String(new FormData(event.currentTarget).get("competition"));
    try {
      const context=await createContentContext(scope,mode,scope==="GLOBAL" ? [] : marketIds,sourceIds);
      await setCompetitionContentContext(competition,context);
      setNotice("Competition content scope saved.");
    } catch(cause){setError(userFacingError(cause));} finally{setBusy(false);}
  };
  const visible = sources.filter(source =>
    (scope==="GLOBAL" ? source.kind!=="CURRICULUM" : source.market_id!=null && marketIds.includes(source.market_id)) &&
    (mode==="HYBRID" || (mode==="SPONSOR_SOURCE" ? source.kind==="SPONSOR_SOURCE" : source.kind!=="SPONSOR_SOURCE")));
  return <section className="qb-content-ops"><h2>Competition Content Scope</h2>
    {error && <p role="alert" className="qb-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <form onSubmit={submit}>
      <div className="qb-content-filters"><label>Competition UUID<input name="competition" required pattern="[0-9a-fA-F-]{36}" disabled={busy}/></label>
        <label>Scope<select value={scope} disabled={busy} onChange={event=>{setScope(event.target.value);setMarketIds([]);setSourceIds([]);}}>{["LOCAL_MARKET","MULTI_MARKET","GLOBAL"].map(value=><option key={value}>{value}</option>)}</select></label>
        <label>Source mode<select value={mode} disabled={busy} onChange={event=>{setMode(event.target.value);setSourceIds([]);}}>{["CURRICULUM_ALIGNED","SPONSOR_SOURCE","HYBRID"].map(value=><option key={value}>{value}</option>)}</select></label>
      </div>
      {scope!=="GLOBAL" && <fieldset disabled={busy}><legend>Markets</legend>{markets.map(market=><label key={market.id}><input type={scope==="LOCAL_MARKET" ? "radio" : "checkbox"} name="markets" checked={marketIds.includes(market.id)} onChange={event=>{setMarketIds(scope==="LOCAL_MARKET" ? [market.id] : event.target.checked ? [...marketIds,market.id] : marketIds.filter(id=>id!==market.id));setSourceIds([]);}}/>{market.name}</label>)}</fieldset>}
      <fieldset disabled={busy}><legend>Approved sources</legend>{visible.map(source=><label key={source.id}><input type="checkbox" checked={sourceIds.includes(source.id)} onChange={event=>setSourceIds(event.target.checked ? [...sourceIds,source.id] : sourceIds.filter(id=>id!==source.id))}/>{source.title} ({source.kind})</label>)}</fieldset>
      <button type="submit" disabled={busy || !sourceIds.length || (scope==="LOCAL_MARKET" && marketIds.length!==1) || (scope==="MULTI_MARKET" && marketIds.length<2)}><Save size={16}/>Save Scope</button>
    </form>
  </section>;
}
