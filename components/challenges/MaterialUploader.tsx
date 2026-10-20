"use client";

import { useCallback, useEffect, useState } from "react";
import { contentList, setReader, setVisibleSections, uploadContent } from "@/lib/api/challenges";
import { CONTENT_TYPES, contentType } from "@/lib/challenges/content-types";
import { LIMITS_TEXT, MAX_DOCUMENTS } from "@/lib/challenges/limits";
import type { ContentAsset } from "@/lib/challenges/types";

// The guided way to load material for a quiz. Three plain steps: say what it is, add it, then choose which chapters people may read and whether they can read before playing.
// The material is analysed as it is loaded (chapters, size, reading time). Reading is closed during a timed round and ends with the competition.
const minutes = (words: number) => Math.max(1, Math.round(words / 200));

export default function MaterialUploader({ campaignId, reader, hasOpeningTime, onChanged, onError }: {
  campaignId: string; reader: { enabled: boolean; closes: "START" | "END" }; hasOpeningTime: boolean; onChanged: () => void; onError: (m: string) => void;
}) {
  const [assets, setAssets] = useState<ContentAsset[] | null>(null), [type, setType] = useState(""), [title, setTitle] = useState(""), [file, setFile] = useState<File | null>(null), [text, setText] = useState("");
  const [rights, setRights] = useState(false), [busy, setBusy] = useState(false), [note, setNote] = useState(""), [drag, setDrag] = useState(false);
  const [visible, setVisible] = useState<Record<string, boolean>>({}), [on, setOn] = useState(reader.enabled), [closes, setClosesState] = useState(reader.closes), [saved, setSaved] = useState("");
  const load = useCallback(() => contentList(campaignId).then((r) => { setAssets(r); setVisible(Object.fromEntries(r.flatMap((a) => a.sections.map((s) => [s.id, s.visible !== false])))); }).catch((e) => { onError(e.message); setAssets([]); }), [campaignId, onError]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setOn(reader.enabled); setClosesState(reader.closes); }, [reader.enabled, reader.closes]);

  const pickFile = (f: File | null | undefined) => { if (!f) return; setFile(f); if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 160)); };
  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); onError(""); setNote(""); setSaved("");
    try {
      const r = await uploadContent({ campaignId, title: title.trim(), contentType: type, file, text });
      setNote(`Loaded. We found ${r.sections} chapter${r.sections === 1 ? "" : "s"} and about ${minutes(r.words)} minutes of reading.`);
      setFile(null); setText(""); setTitle(""); setRights(false); await load(); onChanged();
    } catch (err: any) { onError(err.message); }
    setBusy(false);
  }
  async function saveReading() {
    setBusy(true); onError(""); setSaved("");
    try {
      await setVisibleSections(campaignId, Object.entries(visible).filter(([, v]) => v).map(([k]) => k));
      await setReader(campaignId, on, on ? closes : "END");
      setSaved(on ? "Saved. People who join can read the chosen chapters before they play." : "Saved. Reading is switched off."); await load(); onChanged();
    } catch (err: any) { onError(err.message); }
    setBusy(false);
  }
  const t = type ? contentType(type) : null, full = (assets?.length ?? 0) >= MAX_DOCUMENTS;

  return (
    <>
      <div className="qb-card qb-form">
        <h2>1. What are you loading?</h2>
        <p className="qb-muted">Pick the closest match. It helps us suggest the right kind of questions and lets people find your material.</p>
        <div role="radiogroup" aria-label="Type of material" style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          {CONTENT_TYPES.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={type === c.id} className={`qb-btn ${type === c.id ? "" : "qb-btn-secondary"}`} onClick={() => setType(c.id)}
              style={{ textAlign: "left", height: "auto", whiteSpace: "normal", display: "grid", gap: 2, padding: "10px 12px", justifyContent: "flex-start" }}>
              <span style={{ fontSize: 20 }} aria-hidden="true">{c.icon}</span><strong>{c.label}</strong><span className="qb-small" style={{ opacity: 0.8 }}>{c.bring}</span>
            </button>))}
        </div>
        {t && <p role="status" className="qb-muted">Good questions for this: {t.ideas}</p>}
      </div>

      {type && (
        <form className="qb-card qb-form" onSubmit={add}>
          <h2>2. Add it</h2>
          {full ? <p className="qb-muted">This quiz already has the most documents it can hold ({MAX_DOCUMENTS}).</p> : <>
            <label className="qb-field" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pickFile(e.dataTransfer.files?.[0]); }}
              style={{ border: `2px dashed ${drag ? "currentColor" : "rgba(128,128,128,.5)"}`, borderRadius: 12, padding: 16, textAlign: "center" }}>
              <strong>{file ? file.name : "Drop a file here, or choose one"}</strong>
              <input type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => pickFile(e.target.files?.[0])} />
              <span className="qb-muted qb-small">{LIMITS_TEXT}</span>
            </label>
            {!file && <label className="qb-field">…or paste the text<textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the chapters or sections you want the quiz to cover." /></label>}
            <label className="qb-field">Name of this document<input required minLength={2} maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The Spider and the Drum, or Staff Handbook 2027" /></label>
            <label className="qb-check"><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} /> I own this material or have permission to show it to the people I invite.</label>
            <button className="qb-btn" disabled={busy || !rights || title.trim().length < 2 || (!file && text.trim().length < 40)}>{busy ? "Reading and finding chapters…" : "Load and analyse"}</button>
          </>}
          {note && <p role="status"><strong>{note}</strong></p>}
        </form>
      )}

      {assets && assets.length > 0 && (
        <div className="qb-card qb-form">
          <h2>3. What can people read?</h2>
          <p className="qb-muted">Tick the chapters people may read. Anything unticked stays private and is used only by you to write questions.</p>
          {assets.map((a) => (
            <fieldset key={a.asset_id}>
              <legend><strong>{a.title}</strong> <span className="qb-muted">· {contentType(a.content_type).label} · {a.sections.length} chapter{a.sections.length === 1 ? "" : "s"} · about {minutes(a.versions[0]?.word_count ?? 0)} min</span></legend>
              {a.sections.map((s) => (
                <label key={s.id} className="qb-check" style={{ display: "block" }}>
                  <input type="checkbox" checked={visible[s.id] ?? true} onChange={(e) => setVisible((v) => ({ ...v, [s.id]: e.target.checked }))} /> {s.title} <span className="qb-muted qb-small">({minutes(s.words)} min)</span>
                </label>))}
            </fieldset>))}
          <label className="qb-check"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> <strong>Let people who join read these chapters before they play.</strong></label>
          {on && (
            <div role="radiogroup" aria-label="When reading closes" style={{ display: "grid", gap: 6, marginLeft: 24 }}>
              <label className="qb-check"><input type="radio" name="closes" checked={closes === "END"} onChange={() => setClosesState("END")} /> Reading closes when the competition ends</label>
              <label className="qb-check" style={{ opacity: hasOpeningTime ? 1 : 0.6 }}><input type="radio" name="closes" disabled={!hasOpeningTime} checked={closes === "START"} onChange={() => setClosesState("START")} /> Reading closes when the competition opens {hasOpeningTime ? "" : "(set an opening time first)"}</label>
              <p className="qb-muted qb-small">Reading is always closed while someone is in a timed round, so it cannot be used as an open book.</p>
            </div>)}
          <div><button type="button" className="qb-btn" disabled={busy} onClick={() => void saveReading()}>{busy ? "Saving…" : "Save reading settings"}</button></div>
          {saved && <p role="status">{saved}</p>}
        </div>
      )}
    </>
  );
}
