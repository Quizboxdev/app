"use client";

import { useCallback, useEffect, useState } from "react";
import { contentChunks, contentList, uploadContent } from "@/lib/api/challenges";
import { passagePrompt } from "@/lib/challenges/chunker";
import type { ContentAsset, Passage } from "@/lib/challenges/types";

// Source material for book challenges: upload a PDF, Word or text file (or paste text). It is split into numbered passages; each question can cite one passage and quote it word for word.
// A new upload of the same book is a new version; passages are never edited, so a question's evidence stays exactly as it was.
export default function SourcePanel({ campaignId, picked, onPick, onError }: { campaignId: string; picked: Passage | null; onPick: (p: Passage | null) => void; onError: (m: string) => void }) {
  const [assets, setAssets] = useState<ContentAsset[] | null>(null), [passages, setPassages] = useState<Passage[]>([]), [viewing, setViewing] = useState("");
  const [title, setTitle] = useState(""), [kind, setKind] = useState("book"), [file, setFile] = useState<File | null>(null), [text, setText] = useState(""), [rights, setRights] = useState(false), [busy, setBusy] = useState(false), [note, setNote] = useState("");
  const [assetId, setAssetId] = useState("");
  const load = useCallback(() => contentList(campaignId).then(setAssets).catch((e) => { onError(e.message); setAssets([]); }), [campaignId, onError]);
  useEffect(() => { void load(); }, [load]);

  async function upload(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); onError(""); setNote("");
    try { const r = await uploadContent({ campaignId, title: title.trim(), kind, assetId: assetId || undefined, file, text }); setNote(`Saved as version ${r.version}: ${r.passages} passages.`); setFile(null); setText(""); await load(); }
    catch (err: any) { onError(err.message); }
    setBusy(false);
  }
  async function view(versionId: string) {
    setViewing(versionId); setPassages([]);
    try { setPassages(await contentChunks(campaignId, versionId)); } catch (e: any) { onError(e.message); }
  }
  const asset = assets?.find((a) => a.versions.some((v) => v.version_id === viewing));

  return (
    <>
      <form className="qb-card qb-form" onSubmit={upload}>
        <h2>Add a book or notes</h2>
        <p className="qb-muted">Use material you wrote or have permission to use. The file is read and split into passages; the file itself is not kept. PDF, Word (.docx) or text, up to 8 MB. Scanned pages with no selectable text will not work.</p>
        <div className="qb-grid cols-3">
          <label className="qb-field">Title<input required minLength={2} maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="qb-field">Type<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="book">Book</option><option value="article">Article</option><option value="notes">Notes</option></select></label>
          <label className="qb-field">This is a new version of<select value={assetId} onChange={(e) => { setAssetId(e.target.value); const a = assets?.find((x) => x.asset_id === e.target.value); if (a) setTitle(a.title); }}><option value="">A new source</option>{assets?.map((a) => <option key={a.asset_id} value={a.asset_id}>{a.title}</option>)}</select></label>
        </div>
        <label className="qb-field">File<input type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        {!file && <label className="qb-field">…or paste the text<textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} /></label>}
        <label className="qb-check"><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} /> I wrote this material or have the right to use it for this challenge.</label>
        <button className="qb-btn" disabled={busy || !rights || title.trim().length < 2 || (!file && text.trim().length < 40)}>{busy ? "Reading…" : "Add source"}</button>
        {note && <p role="status">{note}</p>}
      </form>

      <div className="qb-card">
        <h2>Your sources</h2>
        {assets === null ? <p className="qb-muted">Loading…</p> : assets.length === 0 ? <p className="qb-muted">Nothing added yet.</p> : (
          <ul className="qb-list">{assets.map((a) => (
            <li key={a.asset_id}><strong>{a.title}</strong> <span className="qb-muted">({a.kind})</span>
              <ul>{a.versions.map((v) => <li key={v.version_id}>Version {v.version}{v.source_name ? ` · ${v.source_name}` : ""} · {v.chunk_count} passages · <button className="qb-link-btn" onClick={() => view(v.version_id)}>{viewing === v.version_id ? "Showing" : "Show passages"}</button></li>)}</ul>
            </li>))}</ul>
        )}
      </div>

      {viewing && (
        <div className="qb-card">
          <h2>Passages{asset ? `: ${asset.title}` : ""}</h2>
          <p className="qb-muted">Pick a passage, then paste questions on the Questions tab: they will cite it. Or copy a ready-made prompt to get a chat assistant to draft questions from one passage, then paste its answer back.</p>
          {picked && <p role="status"><strong>Selected:</strong> passage {picked.position}{picked.heading ? ` (${picked.heading})` : ""}. <button className="qb-link-btn" onClick={() => onPick(null)}>Clear</button></p>}
          <ol className="qb-list">{passages.map((p) => (
            <li key={p.id} style={picked?.id === p.id ? { fontWeight: 600 } : undefined}>
              {p.heading && <em>{p.heading}. </em>}{p.body.length > 260 ? `${p.body.slice(0, 260)}…` : p.body}
              <div><button className="qb-link-btn" onClick={() => onPick(p)}>Use this passage</button>{" · "}
                <button className="qb-link-btn" onClick={() => void navigator.clipboard.writeText(passagePrompt(asset?.title ?? "the book", { heading: p.heading, body: p.body }, 5))}>Copy question-writing prompt</button></div>
            </li>))}</ol>
        </div>
      )}
    </>
  );
}
