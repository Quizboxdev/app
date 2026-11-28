"use client";

import { useCallback, useEffect, useState } from "react";
import { allChunks, contentList } from "@/lib/api/challenges";
import { passagePrompt } from "@/lib/challenges/chunker";
import { contentType } from "@/lib/challenges/content-types";
import type { ContentAsset, Passage } from "@/lib/challenges/types";
import MaterialUploader from "./MaterialUploader";

// Material for the quiz: loaded, classified and split into chapters by the guided uploader, then browsed here by passage. Each question can cite one passage and quote it word for word.
// A new upload is a new document; passages are never edited, so a question's evidence stays exactly as it was.
export default function SourcePanel({ campaignId, picked, onPick, onError, reader, hasOpeningTime, onChanged }: {
  campaignId: string; picked: Passage | null; onPick: (p: Passage | null) => void; onError: (m: string) => void;
  reader: { enabled: boolean; closes: "START" | "END" }; hasOpeningTime: boolean; onChanged: () => void;
}) {
  const [assets, setAssets] = useState<ContentAsset[] | null>(null), [passages, setPassages] = useState<Passage[]>([]), [viewing, setViewing] = useState("");
  const load = useCallback(() => contentList(campaignId).then(setAssets).catch((e) => { onError(e.message); setAssets([]); }), [campaignId, onError]);
  useEffect(() => { void load(); }, [load]);
  async function view(versionId: string) {
    setViewing(versionId); setPassages([]);
    try { setPassages(await allChunks(campaignId, versionId)); } catch (e: any) { onError(e.message); }
  }
  // Copying the prompt also chooses that passage, so the questions that come back are looked for there first.
  const [copied, setCopied] = useState("");
  async function copyPrompt(p: Passage) {
    try { await navigator.clipboard.writeText(passagePrompt(asset?.title ?? "the book", { heading: p.heading, body: p.body }, 5)); setCopied(p.id); onPick(p); }
    catch { onError("Could not copy. Select the passage text and copy it by hand."); }
  }
  const asset = assets?.find((a) => a.versions.some((v) => v.version_id === viewing));

  return (
    <>
      <MaterialUploader campaignId={campaignId} reader={reader} hasOpeningTime={hasOpeningTime} onError={onError} onChanged={() => { void load(); onChanged(); }} />

      <div className="qb-card">
        <h2>Your material</h2>
        {assets === null ? <p className="qb-muted">Loading…</p> : assets.length === 0 ? <p className="qb-muted">Nothing added yet.</p> : (
          <ul className="qb-list">{assets.map((a) => (
            <li key={a.asset_id}><strong>{a.title}</strong> <span className="qb-muted">({contentType(a.content_type).label})</span>
              <ul>{a.versions.map((v) => <li key={v.version_id}>Version {v.version}{v.source_name ? ` · ${v.source_name}` : ""} · {v.chunk_count} passages · <button className="qb-link-btn" onClick={() => view(v.version_id)}>{viewing === v.version_id ? "Showing" : "Show passages"}</button></li>)}</ul>
            </li>))}</ul>
        )}
      </div>

      {viewing && (
        <div className="qb-card">
          <h2>Passages{asset ? `: ${asset.title}` : ""}</h2>
          <p className="qb-muted">Pick a passage, then paste questions on the Questions tab: they will cite it. Or copy a ready-made prompt into a chat assistant (Gemini, ChatGPT), then paste its whole answer on the Questions tab as it is. Each quote is matched to your book automatically.</p>
          {picked && <p role="status"><strong>Selected:</strong> passage {picked.position}{picked.heading ? ` (${picked.heading})` : ""}. <button className="qb-link-btn" onClick={() => onPick(null)}>Clear</button></p>}
          <ol className="qb-list">{passages.map((p) => (
            <li key={p.id} style={picked?.id === p.id ? { fontWeight: 600 } : undefined}>
              {p.heading && <em>{p.heading}. </em>}{p.body.length > 260 ? `${p.body.slice(0, 260)}…` : p.body}
              <div><button className="qb-link-btn" onClick={() => onPick(p)}>Use this passage</button>{" · "}
                <button className="qb-link-btn" onClick={() => void copyPrompt(p)}>{copied === p.id ? "Prompt copied" : "Copy question-writing prompt"}</button></div>
            </li>))}</ol>
        </div>
      )}
    </>
  );
}
